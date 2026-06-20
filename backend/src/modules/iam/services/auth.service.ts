import {
  Injectable,
  UnauthorizedException,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { UserEntity } from '../entities/user.entity';
import { REDIS_QUEUE_CLIENT } from '../../../core/redis/redis.module';
import { LoginDto } from '../dto/auth.dto';
import { IamDeviceHistoryEntity } from '../entities/device-history.entity';
import {
  IamRedisKeys,
  IamEventTypes,
  IamQueues,
  IamEventPriorities,
} from '../constants/iam.constants';
import { LoginNewDeviceEvent } from '../events/iam.events';

interface RefreshTokenData {
  userId: string;
  email: string;
  ipAddress: string;
  userAgent: string;
  issuedAt: string;
  familyId: string;
  isUsed: boolean;
  usedAt?: string | null;
  replacedBy?: string | null;
}

interface SetupTokenPayload {
  sub: string;
  email: string;
  purpose: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly jwtService: JwtService,
    @Inject(REDIS_QUEUE_CLIENT)
    private readonly redisClient: Redis,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @InjectQueue(IamQueues.OUTBOX) private readonly outboxQueue: Queue,
  ) {}

  async login(dto: LoginDto, ipAddress: string, userAgent: string) {
    const bruteForceKey = `${IamRedisKeys.BRUTE_FORCE}${ipAddress}`;
    const attemptsStr = await this.redisClient.get(bruteForceKey);
    const attempts = attemptsStr ? parseInt(attemptsStr, 10) : 0;

    if (attempts >= 5) {
      this.logger.warn(`Brute-force blocked for IP: ${ipAddress}`);
      throw new UnauthorizedException(
        'Too many failed attempts. Try again later.',
      );
    }

    const user = await this.userRepository.findOne({
      where: { email: dto.email, isActive: true },
      select: { id: true, email: true, passwordHash: true, isActive: true, fullName: true },
    });
    this.logger.debug(`[DEBUG] Fetched user: ${JSON.stringify(user)}`);

    if (!user || !user.passwordHash) {
      await this.handleFailedAttempt(bruteForceKey, attempts);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      await this.handleFailedAttempt(bruteForceKey, attempts);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (attempts > 0) {
      await this.redisClient.del(bruteForceKey);
    }

    const payload = { sub: user.id, email: user.email };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = crypto.randomBytes(32).toString('hex');

    const redisKey = `${IamRedisKeys.REFRESH_TOKEN}${refreshToken}`;
    const familyId = crypto.randomUUID();
    const tokenData: RefreshTokenData = {
      userId: user.id,
      email: user.email,
      ipAddress,
      userAgent,
      issuedAt: new Date().toISOString(),
      familyId,
      isUsed: false,
    };

    const refreshExpiresIn = parseInt(
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '604800',
      10,
    );
    await this.redisClient.set(
      redisKey,
      JSON.stringify(tokenData),
      'EX',
      refreshExpiresIn,
    );
    await this.redisClient.sadd(
      `${IamRedisKeys.USER_SESSIONS}${user.id}`,
      refreshToken,
    );
    await this.redisClient.expire(
      `${IamRedisKeys.USER_SESSIONS}${user.id}`,
      refreshExpiresIn,
    );

    const deviceHash = crypto
      .createHash('sha256')
      .update(`${ipAddress}_${userAgent}`)
      .digest('hex');

    let sendSecurityAlert = false;

    await this.dataSource.transaction(async (manager) => {
      const deviceHistoryRepo = manager.getRepository(IamDeviceHistoryEntity);

      const existingDevice = await deviceHistoryRepo.findOne({
        where: { userId: user.id, deviceHash },
      });

      if (existingDevice) {
        existingDevice.lastLoginAt = new Date();
        existingDevice.ipAddress = ipAddress;
        existingDevice.userAgent = userAgent;
        await deviceHistoryRepo.save(existingDevice);
      } else {
        try {
          await deviceHistoryRepo.insert({
            userId: user.id,
            ipAddress: ipAddress,
            userAgent: userAgent,
            deviceHash: deviceHash,
            isTrusted: true,
            lastLoginAt: new Date(),
          });
          sendSecurityAlert = true;
        } catch (err) {
          const dbError = err as { code?: string };
          if (dbError.code === '23505') {
            const conflictDevice = await deviceHistoryRepo.findOne({
              where: { userId: user.id, deviceHash },
            });
            if (conflictDevice) {
              conflictDevice.lastLoginAt = new Date();
              conflictDevice.ipAddress = ipAddress;
              conflictDevice.userAgent = userAgent;
              await deviceHistoryRepo.save(conflictDevice);
            }
          } else {
            throw err;
          }
        }
      }
    });

    if (sendSecurityAlert) {
      try {
        const priority =
          IamEventPriorities[IamEventTypes.AUTH_LOGIN_NEW_DEVICE] || 5;
        await this.outboxQueue.add(
          'process_event',
          {
            eventType: IamEventTypes.AUTH_LOGIN_NEW_DEVICE,
            payload: new LoginNewDeviceEvent(
              user.id,
              user.email,
              ipAddress,
              userAgent,
              new Date().toISOString(),
            ),
          },
          { priority },
        );
      } catch (err) {
        this.logger.error(
          `Failed to push direct security alert event to BullMQ`,
          err,
        );
      }
    }

    this.logger.debug(`User ${user.email} logged in from ${ipAddress}`);

    const accessExpiresIn = parseInt(
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '900',
      10,
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: accessExpiresIn,
    };
  }

  async refresh(oldRefreshToken: string) {
    const lockKey = `iam:lock:refresh:${oldRefreshToken}`;
    const acquired = await this.redisClient.set(lockKey, 'LOCK', 'EX', 2, 'NX');
    if (!acquired) {
      throw new UnauthorizedException(
        'Refresh token is already being processed. Please retry.',
      );
    }

    try {
      const redisKey = `${IamRedisKeys.REFRESH_TOKEN}${oldRefreshToken}`;
      const tokenDataStr = await this.redisClient.get(redisKey);

      if (!tokenDataStr) {
        this.logger.warn(`Invalid or expired refresh token attempted`);
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      const tokenData = JSON.parse(tokenDataStr) as RefreshTokenData;

      if (tokenData.isUsed) {
        const gracePeriodSec = 30; // Grace period in seconds
        const usedAt = tokenData.usedAt
          ? new Date(tokenData.usedAt).getTime()
          : 0;
        const now = Date.now();
        const diffSec = (now - usedAt) / 1000;

        if (usedAt > 0 && diffSec < gracePeriodSec && tokenData.replacedBy) {
          const replacedKey = `${IamRedisKeys.REFRESH_TOKEN}${tokenData.replacedBy}`;
          const replacedDataStr = await this.redisClient.get(replacedKey);
          if (replacedDataStr) {
            const payload = { sub: tokenData.userId, email: tokenData.email };
            const accessToken = this.jwtService.sign(payload);
            return {
              accessToken,
              refreshToken: tokenData.replacedBy,
              expiresIn: parseInt(
                this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ||
                  '900',
                10,
              ),
            };
          }
        }

        this.logger.warn(
          `BREACH DETECTED for user ${tokenData.userId}! Replayed token used. Revoking all sessions.`,
        );
        await this.revokeAllSessions(tokenData.userId);
        throw new UnauthorizedException(
          'Security breach detected. All sessions have been revoked. Please log in again.',
        );
      }

      const newRefreshToken = crypto.randomBytes(32).toString('hex');
      const newRedisKey = `${IamRedisKeys.REFRESH_TOKEN}${newRefreshToken}`;

      const payload = { sub: tokenData.userId, email: tokenData.email };
      const accessToken = this.jwtService.sign(payload);

      const refreshExpiresIn = parseInt(
        this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '604800',
        10,
      );

      // Mark old token as used to detect future replays
      tokenData.isUsed = true;
      tokenData.usedAt = new Date().toISOString();
      tokenData.replacedBy = newRefreshToken;

      await this.redisClient.set(
        redisKey,
        JSON.stringify(tokenData),
        'EX',
        refreshExpiresIn,
      );
      await this.redisClient.srem(
        `${IamRedisKeys.USER_SESSIONS}${tokenData.userId}`,
        oldRefreshToken,
      );

      const newTokenData: RefreshTokenData = {
        ...tokenData,
        isUsed: false,
        issuedAt: new Date().toISOString(),
        usedAt: undefined,
        replacedBy: undefined,
      };

      await this.redisClient.set(
        newRedisKey,
        JSON.stringify(newTokenData),
        'EX',
        refreshExpiresIn,
      );
      await this.redisClient.sadd(
        `${IamRedisKeys.USER_SESSIONS}${tokenData.userId}`,
        newRefreshToken,
      );
      await this.redisClient.expire(
        `${IamRedisKeys.USER_SESSIONS}${tokenData.userId}`,
        refreshExpiresIn,
      );

      const accessExpiresIn = parseInt(
        this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '900',
        10,
      );

      return {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: accessExpiresIn,
      };
    } finally {
      await this.redisClient.del(lockKey).catch((err) => {
        this.logger.error(
          `Failed to release lock for refresh token: ${oldRefreshToken}`,
          err,
        );
      });
    }
  }

  async logout(refreshToken: string) {
    if (refreshToken) {
      const redisKey = `${IamRedisKeys.REFRESH_TOKEN}${refreshToken}`;
      const tokenDataStr = await this.redisClient.get(redisKey);

      if (tokenDataStr) {
        const tokenData = JSON.parse(tokenDataStr) as RefreshTokenData;
        await this.redisClient.srem(
          `${IamRedisKeys.USER_SESSIONS}${tokenData.userId}`,
          refreshToken,
        );
        await this.redisClient.del(
          `${IamRedisKeys.USER_PERMISSIONS}${tokenData.userId}`,
        );
      }
      await this.redisClient.del(redisKey);
    }
    return true;
  }

  async revokeAllSessions(userId: string) {
    const sessionsKey = `${IamRedisKeys.USER_SESSIONS}${userId}`;
    const sessions = await this.redisClient.smembers(sessionsKey);

    if (sessions.length > 0) {
      const pipeline = this.redisClient.pipeline();
      for (const token of sessions) {
        pipeline.del(`${IamRedisKeys.REFRESH_TOKEN}${token}`);
      }
      await pipeline.exec();
    }

    await this.redisClient.del(sessionsKey);
    await this.redisClient.del(`${IamRedisKeys.USER_PERMISSIONS}${userId}`);
    this.logger.debug(`Revoked all sessions for user ${userId}`);
  }

  async exchangeActivationToken(email: string, token: string) {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const redisKey = `${IamRedisKeys.ACTIVATION_HASH}${hash}`;
    const tokenDataStr = await this.redisClient.get(redisKey);
    if (!tokenDataStr) {
      throw new BadRequestException('Invalid or expired activation token');
    }

    let tokenData: { email: string; userId: string };
    try {
      // Attempt to parse as JSON first (new format)
      const parsed = JSON.parse(tokenDataStr) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'email' in parsed &&
        'userId' in parsed &&
        typeof (parsed as Record<string, unknown>).email === 'string' &&
        typeof (parsed as Record<string, unknown>).userId === 'string'
      ) {
        tokenData = {
          email: (parsed as Record<string, unknown>).email as string,
          userId: (parsed as Record<string, unknown>).userId as string,
        };
      } else {
        throw new Error('Invalid JSON format');
      }
    } catch {
      // Fallback for compatibility (e.g. if Redis key only stored a string userId)
      if (typeof tokenDataStr === 'string' && tokenDataStr.trim().length > 0) {
        tokenData = { email: '', userId: tokenDataStr };
      } else {
        throw new BadRequestException('Invalid or expired activation token');
      }
    }

    if (tokenData.email !== email) {
      throw new BadRequestException(
        'Email does not match the activation token',
      );
    }

    const user = await this.userRepository.findOne({
      where: { id: tokenData.userId },
    });
    if (!user) throw new BadRequestException('User not found');

    const setupExpiresIn =
      this.configService.get<string>('JWT_SETUP_EXPIRES_IN') || '15m';

    const setupToken = this.jwtService.sign(
      { sub: user.id, email: user.email, purpose: 'account_setup' },
      {
        secret: this.configService.get<string>('JWT_SETUP_SECRET'),
        expiresIn: setupExpiresIn as JwtSignOptions['expiresIn'],
      },
    );

    await this.redisClient.del(redisKey);

    return {
      setupToken,
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
    };
  }

  async activateUser(
    setupTokenStr: string,
    passwordPlain: string,
    ipAddress: string,
    userAgent: string,
  ) {
    let payload: SetupTokenPayload;
    try {
      payload = this.jwtService.verify(setupTokenStr, {
        secret: this.configService.get<string>('JWT_SETUP_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired setup token');
    }

    if (payload.purpose !== 'account_setup') {
      throw new UnauthorizedException('Invalid token purpose');
    }

    const userId = payload.sub;
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.passwordHash !== null) {
      throw new UnauthorizedException('Account setup already completed');
    }
    if (user.isActive)
      throw new UnauthorizedException('Account already active');

    this.validatePasswordStrength(passwordPlain);

    const newHash = await bcrypt.hash(passwordPlain, 10);
    user.passwordHash = newHash;
    user.isActive = true;
    await this.userRepository.save(user);

    // Auto login
    return this.login(
      { email: user.email, password: passwordPlain },
      ipAddress,
      userAgent,
    );
  }

  validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new BadRequestException(
        'Password must be at least 8 characters long',
      );
    }
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    if (!hasUpperCase || !hasLowerCase || !hasNumber) {
      throw new BadRequestException(
        'Password must contain at least one uppercase letter, one lowercase letter, and one number',
      );
    }
  }

  private async handleFailedAttempt(key: string, currentAttempts: number) {
    const blockMinSec =
      this.configService.get<number>('BRUTE_FORCE_BLOCK_MIN_SEC') || 300;
    const blockMaxSec =
      this.configService.get<number>('BRUTE_FORCE_BLOCK_MAX_SEC') || 900;

    if (currentAttempts === 0) {
      await this.redisClient.set(key, '1', 'EX', blockMinSec);
    } else {
      const next = currentAttempts + 1;
      if (next >= 5) {
        await this.redisClient.set(key, next.toString(), 'EX', blockMaxSec);
      } else {
        await this.redisClient.incr(key);
      }
    }
  }
}
