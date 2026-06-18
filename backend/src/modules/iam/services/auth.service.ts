/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  UnauthorizedException,
  Inject,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
import { IamOutboxEntity } from '../entities/iam-outbox.entity';

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
    @InjectQueue('iam_outbox') private readonly outboxQueue: Queue,
  ) {}

  async login(dto: LoginDto, ipAddress: string, userAgent: string) {
    const bruteForceKey = `iam:brute_force:${ipAddress}`;
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
    });

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

    const redisKey = `iam:refresh_token:${refreshToken}`;
    const tokenData = {
      userId: user.id,
      email: user.email,
      ipAddress,
      userAgent,
      issuedAt: new Date().toISOString(),
    };

    const refreshExpiresIn = this.configService.get<number>(
      'JWT_REFRESH_EXPIRES_IN',
    )!;
    await this.redisClient.set(
      redisKey,
      JSON.stringify(tokenData),
      'EX',
      refreshExpiresIn,
    );

    const deviceHash = crypto
      .createHash('sha256')
      .update(`${ipAddress}_${userAgent}`)
      .digest('hex');

    let newOutboxEventId: string | null = null;

    await this.dataSource.transaction(async (manager) => {
      const deviceHistoryRepo = manager.getRepository(IamDeviceHistoryEntity);
      const outboxRepo = manager.getRepository(IamOutboxEntity);

      const existingDevice = await deviceHistoryRepo.findOne({
        where: { userId: user.id, deviceHash },
      });

      if (existingDevice) {
        existingDevice.lastLoginAt = new Date();
        await deviceHistoryRepo.save(existingDevice);
      } else {
        await deviceHistoryRepo.save({
          userId: user.id,
          ipAddress: ipAddress,
          userAgent: userAgent,
          deviceHash: deviceHash,
          isTrusted: true,
          lastLoginAt: new Date(),
        });

        const outboxEvent = await outboxRepo.save({
          eventType: 'auth.login_new_device',
          payload: {
            userId: user.id,
            email: user.email,
            ipAddress,
            userAgent,
            timestamp: new Date().toISOString(),
          },
          status: 'PENDING',
        });
        
        newOutboxEventId = outboxEvent.id;
      }
    });

    if (newOutboxEventId) {
      await this.outboxQueue.add('process_event', { eventId: newOutboxEventId });
    }

    this.logger.debug(`User ${user.email} logged in from ${ipAddress}`);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.configService.get<number>('JWT_ACCESS_EXPIRES_IN'),
    };
  }

  async refresh(oldRefreshToken: string) {
    const redisKey = `iam:refresh_token:${oldRefreshToken}`;
    const tokenDataStr = await this.redisClient.get(redisKey);

    if (!tokenDataStr) {
      this.logger.warn(`Invalid or expired refresh token attempted`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const tokenData = JSON.parse(tokenDataStr);
    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    const newRedisKey = `iam:refresh_token:${newRefreshToken}`;

    const payload = { sub: tokenData.userId, email: tokenData.email };
    const accessToken = this.jwtService.sign(payload);

    const refreshExpiresIn = this.configService.get<number>(
      'JWT_REFRESH_EXPIRES_IN',
    )!;
    await this.redisClient.set(
      newRedisKey,
      JSON.stringify(tokenData),
      'EX',
      refreshExpiresIn,
    );
    await this.redisClient.del(redisKey);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: this.configService.get<number>('JWT_ACCESS_EXPIRES_IN'),
    };
  }

  async logout(refreshToken: string) {
    if (refreshToken) {
      await this.redisClient.del(`iam:refresh_token:${refreshToken}`);
    }
    return true;
  }

  private async handleFailedAttempt(key: string, currentAttempts: number) {
    if (currentAttempts === 0) {
      await this.redisClient.set(key, '1', 'EX', 5 * 60);
    } else {
      const next = currentAttempts + 1;
      if (next >= 5) {
        await this.redisClient.set(key, next.toString(), 'EX', 15 * 60);
      } else {
        await this.redisClient.incr(key);
      }
    }
  }
}
