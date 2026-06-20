import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { UserEntity } from '../entities/user.entity';
import { UserSettingEntity } from '../entities/user-setting.entity';
import { RoleEntity } from '../entities/role.entity';
import { UserRoleEntity } from '../entities/user-role.entity';
import { RoleAuditLogEntity } from '../entities/role-audit-log.entity';
import { CreateUserDto, UpdateUserDto } from '../dto/user.dto';
import { IamOutboxEntity } from '../entities/iam-outbox.entity';
import { REDIS_CACHE_CLIENT } from '../../../core/redis/redis.module';
import { ConfigService } from '@nestjs/config';
import {
  IamRedisKeys,
  IamEventTypes,
  IamQueues,
  IamDefaults,
  IamEventPriorities,
} from '../constants/iam.constants';
import { UserCreatedEvent, PermissionChangedEvent } from '../events/iam.events';
import { AuthService } from './auth.service';
import { PermissionService } from './permission.service';
import { UserListQueryDto } from '../dto/user.dto';
import { PaginatedResponseDto } from '../../../core/dto/pagination.dto';
import { TypeOrmQueryHelper } from '../../../core/database/typeorm-query.helper';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    @InjectQueue(IamQueues.OUTBOX) private readonly outboxQueue: Queue,
    @Inject(REDIS_CACHE_CLIENT) private readonly redisClient: Redis,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
  ) {}

  async findAll(
    query: UserListQueryDto,
  ): Promise<PaginatedResponseDto<UserEntity>> {
    const page = query.page || 1;
    const limit = query.limit || 20;

    const dbQuery = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.setting', 'setting')
      .leftJoinAndSelect('user.userRoles', 'userRole')
      .leftJoinAndSelect('userRole.role', 'role');

    // Nạp Phân trang, Tìm kiếm, Sắp xếp động, và Bộ lọc isActive từ Helper
    TypeOrmQueryHelper.apply(dbQuery, query, {
      alias: 'user',
      searchFields: ['user.fullName', 'user.email'],
      filterableFields: ['isActive'],
    });

    // Lọc thủ công khóa ngoại thuộc bảng UserRoles (do tính chất liên kết quan hệ)
    if (query.roleId) {
      dbQuery
        .innerJoin('user.userRoles', 'filterUserRole')
        .andWhere('filterUserRole.roleId = :roleId', { roleId: query.roleId });
    }

    // Nếu query không yêu cầu sort động, ta thiết lập mặc định là user.createdAt DESC
    if (!query.sort) {
      dbQuery.orderBy('user.createdAt', 'DESC');
    }

    const [data, total] = await dbQuery.getManyAndCount();
    return new PaginatedResponseDto(data, total, page, limit);
  }

  async findById(id: string): Promise<UserEntity> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: { setting: true, userRoles: { role: true } },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async createUser(dto: CreateUserDto, createdBy: string): Promise<UserEntity> {
    const existing = await this.userRepository.findOne({
      where: { email: dto.email },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException('Email already exists');
    }

    const activationTokenPlain = crypto.randomBytes(32).toString('hex');
    const activationTokenHash = crypto
      .createHash('sha256')
      .update(activationTokenPlain)
      .digest('hex');

    let outboxEventId: string | null = null;
    let savedUser: UserEntity | null = null;

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const userRepo = manager.getRepository(UserEntity);
        const outboxRepo = manager.getRepository(IamOutboxEntity);

        const user = userRepo.create({
          fullName: dto.fullName,
          email: dto.email,
          isActive: false,
        });

        const saved = await userRepo.save(user);

        const settingsRepo = manager.getRepository(UserSettingEntity);
        const settings = settingsRepo.create({
          userId: saved.id,
          preferredLang: IamDefaults.LANG,
          timezone: IamDefaults.TIMEZONE,
          theme: IamDefaults.THEME,
        });
        await settingsRepo.save(settings);
        saved.setting = settings;

        const outboxEvent = await outboxRepo.save({
          eventType: IamEventTypes.AUTH_USER_CREATED,
          payload: new UserCreatedEvent(
            saved.id,
            saved.email,
            saved.fullName,
            createdBy,
            activationTokenPlain,
            new Date().toISOString(),
            settings.preferredLang,
          ),
          status: 'PENDING',
        });

        // Save token hash to Redis (TTL 48h) - INSIDE transaction to ensure consistency
        const ttl =
          this.configService.get<number>('ACTIVATION_TOKEN_TTL_SEC') || 172800;
        await this.redisClient.set(
          `${IamRedisKeys.ACTIVATION_HASH}${activationTokenHash}`,
          JSON.stringify({ email: saved.email, userId: saved.id }),
          'EX',
          ttl,
        );

        return { saved: saved, outboxEventId: outboxEvent.id };
      });

      savedUser = result.saved;
      outboxEventId = result.outboxEventId;
    } catch (err) {
      const dbError = err as { code?: string };
      if (dbError.code === '23505') {
        throw new ConflictException('Email already exists');
      }
      throw err;
    }

    if (outboxEventId) {
      try {
        const priority =
          IamEventPriorities[IamEventTypes.AUTH_USER_CREATED] || 5;
        await this.outboxQueue.add(
          'process_event',
          { eventId: outboxEventId },
          { priority },
        );
      } catch (err) {
        this.logger.warn(
          `Failed to immediately enqueue outbox event ${outboxEventId}`,
          err,
        );
      }
      this.logger.debug(
        `User ${savedUser.email} created. Activation token generated.`,
      );
    }

    return savedUser;
  }

  async resendActivation(userId: string, adminId: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: { setting: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.isActive) {
      throw new BadRequestException('User is already activated');
    }

    const activationTokenPlain = crypto.randomBytes(32).toString('hex');
    const activationTokenHash = crypto
      .createHash('sha256')
      .update(activationTokenPlain)
      .digest('hex');

    let outboxEventId: string | null = null;

    outboxEventId = await this.dataSource.transaction(async (manager) => {
      const outboxRepo = manager.getRepository(IamOutboxEntity);

      const outboxEvent = await outboxRepo.save({
        eventType: IamEventTypes.AUTH_USER_CREATED,
        payload: new UserCreatedEvent(
          user.id,
          user.email,
          user.fullName,
          adminId,
          activationTokenPlain,
          new Date().toISOString(),
          user.setting?.preferredLang || IamDefaults.LANG,
        ),
        status: 'PENDING',
      });

      // Save token hash to Redis (TTL 48h) - INSIDE transaction to ensure consistency
      const ttl =
        this.configService.get<number>('ACTIVATION_TOKEN_TTL_SEC') || 172800;
      await this.redisClient.set(
        `${IamRedisKeys.ACTIVATION_HASH}${activationTokenHash}`,
        JSON.stringify({ email: user.email, userId: user.id }),
        'EX',
        ttl,
      );

      return outboxEvent.id;
    });

    if (outboxEventId) {
      try {
        const priority =
          IamEventPriorities[IamEventTypes.AUTH_USER_CREATED] || 5;
        await this.outboxQueue.add(
          'process_event',
          { eventId: outboxEventId },
          { priority },
        );
      } catch (err) {
        this.logger.warn(
          `Failed to immediately enqueue outbox event ${outboxEventId}`,
          err,
        );
      }
      this.logger.debug(`Resent activation for user ${user.email}.`);
    }
  }

  async updateUser(
    userId: string,
    dto: UpdateUserDto,
    adminId: string,
    adminIp: string,
  ): Promise<UserEntity> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: { setting: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (userId === adminId) {
      if (dto.isActive === false) {
        throw new BadRequestException(
          'Administrators cannot deactivate themselves',
        );
      }
      if (dto.roleCode !== undefined) {
        throw new BadRequestException(
          'Administrators cannot change their own role',
        );
      }
    }

    let outboxEventId: string | null = null;
    let permissionsChanged = false;

    if (dto.fullName) user.fullName = dto.fullName;

    const oldActiveStatus = user.isActive;
    if (dto.isActive !== undefined) {
      user.isActive = dto.isActive;
    }

    const txResult = await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(UserEntity);
      const userRoleRepo = manager.getRepository(UserRoleEntity);
      const roleRepo = manager.getRepository(RoleEntity);
      const outboxRepo = manager.getRepository(IamOutboxEntity);
      const auditRepo = manager.getRepository(RoleAuditLogEntity);

      // Save user profile & status changes
      await userRepo.save(user);

      if (
        dto.preferredLang !== undefined ||
        dto.timezone !== undefined ||
        dto.theme !== undefined
      ) {
        const settingsRepo = manager.getRepository(UserSettingEntity);
        let settings = await settingsRepo.findOne({ where: { userId } });
        if (!settings) {
          settings = settingsRepo.create({ userId });
        }
        if (dto.preferredLang !== undefined)
          settings.preferredLang = dto.preferredLang;
        if (dto.timezone !== undefined) settings.timezone = dto.timezone;
        if (dto.theme !== undefined) settings.theme = dto.theme;
        await settingsRepo.save(settings);
      }

      let innerOutboxEventId: string | null = null;
      let innerPermsChanged = false;

      if (dto.roleCode !== undefined) {
        const role = await roleRepo.findOne({ where: { code: dto.roleCode } });
        if (!role) {
          throw new NotFoundException(`Role ${dto.roleCode} not found`);
        }

        // Get current roles
        const currentRoles = await userRoleRepo.find({ where: { userId } });
        const hasRoleAlready = currentRoles.some((r) => r.roleId === role.id);

        if (!hasRoleAlready || currentRoles.length > 1) {
          // Clear current roles
          await userRoleRepo.delete({ userId });
          // Assign new role
          await userRoleRepo.save({
            userId,
            roleId: role.id,
            grantedBy: adminId,
          });

          innerPermsChanged = true;

          // Save audit log
          await auditRepo.save({
            userId: adminId,
            action: 'UPDATE_USER_ROLE',
            target: userId,
            payload: {
              oldRoles: currentRoles.map((cr) => cr.roleId),
              newRole: role.code,
            },
            ipAddress: adminIp,
          });

          // Save outbox event
          const outboxEvent = await outboxRepo.save({
            eventType: IamEventTypes.PERMISSION_CHANGED,
            payload: new PermissionChangedEvent(
              userId,
              adminId,
              'ASSIGN_ROLE',
              { roleCode: role.code },
              new Date().toISOString(),
            ),
            status: 'PENDING',
          });
          innerOutboxEventId = outboxEvent.id;
        }
      }

      return { innerOutboxEventId, innerPermsChanged };
    });

    outboxEventId = txResult.innerOutboxEventId;
    permissionsChanged = txResult.innerPermsChanged;

    // Post-transaction tasks
    if (user.isActive === false && oldActiveStatus === true) {
      // Deactivated: Revoke all sessions immediately
      await this.authService.revokeAllSessions(userId);
      await this.redisClient.del(`iam:user_active:${userId}`);
    } else if (user.isActive === true && oldActiveStatus === false) {
      // Activated/re-enabled: Clear active cache to reload
      await this.redisClient.del(`iam:user_active:${userId}`);
    }

    if (permissionsChanged) {
      // Invalidate permissions cache
      await this.permissionService.invalidateUserPermissionCache(userId);
    }

    if (outboxEventId) {
      try {
        const priority =
          IamEventPriorities[IamEventTypes.PERMISSION_CHANGED] || 5;
        await this.outboxQueue.add(
          'process_event',
          { eventId: outboxEventId },
          { priority },
        );
      } catch (err) {
        this.logger.warn(
          `Failed to immediately enqueue outbox event ${outboxEventId}`,
          err,
        );
      }
    }

    return user;
  }

  /**
   * Khởi tạo lại mật khẩu do Admin yêu cầu: Đưa user về trạng thái chưa kích hoạt và gửi link thiết lập lại mật khẩu
   */
  async resetPassword(userId: string, adminId: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: { setting: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (userId === adminId) {
      throw new BadRequestException('Administrators cannot reset their own password.');
    }

    const activationTokenPlain = crypto.randomBytes(32).toString('hex');
    const activationTokenHash = crypto
      .createHash('sha256')
      .update(activationTokenPlain)
      .digest('hex');

    let outboxEventId: string | null = null;

    outboxEventId = await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(UserEntity);
      const outboxRepo = manager.getRepository(IamOutboxEntity);

      // Cập nhật User về trạng thái chưa kích hoạt
      user.isActive = false;
      user.passwordHash = null;
      await userRepo.save(user);

      const outboxEvent = await outboxRepo.save({
        eventType: IamEventTypes.AUTH_USER_CREATED,
        payload: new UserCreatedEvent(
          user.id,
          user.email,
          user.fullName,
          adminId,
          activationTokenPlain,
          new Date().toISOString(),
          user.setting?.preferredLang || IamDefaults.LANG,
        ),
        status: 'PENDING',
      });

      // Save token hash to Redis (TTL 48h)
      const ttl =
        this.configService.get<number>('ACTIVATION_TOKEN_TTL_SEC') || 172800;
      await this.redisClient.set(
        `${IamRedisKeys.ACTIVATION_HASH}${activationTokenHash}`,
        JSON.stringify({ email: user.email, userId: user.id }),
        'EX',
        ttl,
      );

      return outboxEvent.id;
    });

    // Thu hồi toàn bộ phiên đăng nhập của user này ngay lập tức
    await this.authService.revokeAllSessions(userId);
    await this.redisClient.del(`iam:user_active:${userId}`);

    if (outboxEventId) {
      try {
        const priority =
          IamEventPriorities[IamEventTypes.AUTH_USER_CREATED] || 5;
        await this.outboxQueue.add(
          'process_event',
          { eventId: outboxEventId },
          { priority },
        );
      } catch (err) {
        this.logger.warn(
          `Failed to immediately enqueue outbox event ${outboxEventId}`,
          err,
        );
      }
      this.logger.debug(`Reset password initiated for user ${user.email}.`);
    }
  }
}

