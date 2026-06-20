import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';
import { UserEntity } from '../entities/user.entity';
import { UserSettingEntity } from '../entities/user-setting.entity';
import { UpdateProfileDto, ChangePasswordDto } from '../dto/profile.dto';
import { AuthService } from './auth.service';
import { IamOutboxEntity } from '../entities/iam-outbox.entity';
import {
  IamQueues,
  IamEventTypes,
  IamEventPriorities,
} from '../constants/iam.constants';
import { PasswordChangedEvent } from '../events/iam.events';
import { REDIS_CACHE_CLIENT } from '../../../core/redis/redis.module';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly authService: AuthService,
    private readonly dataSource: DataSource,
    @InjectQueue(IamQueues.OUTBOX) private readonly outboxQueue: Queue,
    @Inject(REDIS_CACHE_CLIENT) private readonly redisClient: Redis,
    private readonly configService: ConfigService,
  ) {}

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserEntity> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: { setting: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.fullName) user.fullName = dto.fullName;
    if (dto.avatarUrl) {
      const publicUrl =
        this.configService.get<string>('STORAGE_PUBLIC_URL') ||
        'http://localhost:9000/user-media';
      try {
        const parsedUrl = new URL(dto.avatarUrl);
        const parsedPublic = new URL(publicUrl);
        // Ensure same origin and starts with the expected path
        if (
          parsedUrl.origin !== parsedPublic.origin ||
          !parsedUrl.pathname.startsWith(parsedPublic.pathname)
        ) {
          throw new BadRequestException(
            'Avatar URL must point to the internal user-media bucket',
          );
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        throw new BadRequestException('Invalid avatar URL format');
      }
      user.avatarUrl = dto.avatarUrl;
    }

    await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(UserEntity);
      const settingsRepo = manager.getRepository(UserSettingEntity);

      await userRepo.save(user);

      if (
        dto.preferredLang !== undefined ||
        dto.timezone !== undefined ||
        dto.theme !== undefined
      ) {
        let settings = await settingsRepo.findOne({ where: { userId } });
        if (!settings) {
          settings = settingsRepo.create({ userId });
        }
        if (dto.preferredLang !== undefined)
          settings.preferredLang = dto.preferredLang;
        if (dto.timezone !== undefined) settings.timezone = dto.timezone;
        if (dto.theme !== undefined) settings.theme = dto.theme;
        await settingsRepo.save(settings);
        user.setting = settings;
      }
    });

    return user;
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    ipAddress: string,
    userAgent: string,
  ): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.passwordHash) {
      throw new NotFoundException('User not found or password not set');
    }

    const isMatch = await bcrypt.compare(dto.oldPassword, user.passwordHash);
    if (!isMatch) {
      throw new BadRequestException('Invalid old password');
    }

    if (dto.newPassword === dto.oldPassword) {
      throw new BadRequestException(
        'New password must be different from the old password',
      );
    }

    this.authService.validatePasswordStrength(dto.newPassword);

    const newHash = await bcrypt.hash(dto.newPassword, 10);
    let outboxEventId: string | null = null;

    await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(UserEntity);
      const outboxRepo = manager.getRepository(IamOutboxEntity);

      user.passwordHash = newHash;
      await userRepo.save(user);

      const outboxEvent = await outboxRepo.save({
        eventType: IamEventTypes.AUTH_PASSWORD_CHANGED,
        payload: new PasswordChangedEvent(
          user.id,
          user.id,
          ipAddress,
          userAgent,
          new Date().toISOString(),
        ),
        status: 'PENDING',
      });
      outboxEventId = outboxEvent.id;
    });

    // Revoke all sessions (forces user to re-login on all devices)
    await this.authService.revokeAllSessions(userId);

    // Invalidate user active status cache
    await this.redisClient.del(`iam:user_active:${userId}`);

    if (outboxEventId) {
      const priority =
        IamEventPriorities[IamEventTypes.AUTH_PASSWORD_CHANGED] || 5;
      await this.outboxQueue.add(
        'process_event',
        { eventId: outboxEventId },
        { priority },
      );
      this.logger.debug(
        `Password changed for user ${userId}, outbox event created.`,
      );
    }
  }
}
