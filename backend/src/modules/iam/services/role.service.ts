import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { RoleEntity } from '../entities/role.entity';
import { UserRoleEntity } from '../entities/user-role.entity';
import { UserEntity } from '../entities/user.entity';
import { IamOutboxEntity } from '../entities/iam-outbox.entity';
import { PermissionService } from './permission.service';
import { RoleAuditLogEntity } from '../entities/role-audit-log.entity';
import {
  IamEventTypes,
  IamQueues,
  IamEventPriorities,
} from '../constants/iam.constants';
import { PermissionChangedEvent } from '../events/iam.events';

@Injectable()
export class RoleService {
  private readonly logger = new Logger(RoleService.name);

  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepository: Repository<UserRoleEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    @InjectQueue(IamQueues.OUTBOX) private readonly outboxQueue: Queue,
    private readonly permissionService: PermissionService,
  ) {}

  async assignRole(
    userId: string,
    roleCode: string,
    assignedBy: string,
    adminIp: string,
  ): Promise<void> {
    const userExists = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!userExists) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const role = await this.roleRepository.findOne({
      where: { code: roleCode },
    });
    if (!role) {
      throw new NotFoundException(`Role ${roleCode} not found`);
    }

    let outboxEventId: string | null = null;

    await this.dataSource.transaction(async (manager) => {
      const userRoleRepo = manager.getRepository(UserRoleEntity);
      const outboxRepo = manager.getRepository(IamOutboxEntity);

      const existing = await userRoleRepo.findOne({
        where: { userId, roleId: role.id },
      });
      if (existing) {
        return; // Already assigned
      }

      await userRoleRepo.save({
        userId,
        roleId: role.id,
        grantedBy: assignedBy,
      });

      const auditRepo = manager.getRepository(RoleAuditLogEntity);
      await auditRepo.save({
        userId: assignedBy,
        action: 'ASSIGN_ROLE',
        target: userId,
        payload: { roleCode },
        ipAddress: adminIp,
      });

      const outboxEvent = await outboxRepo.save({
        eventType: IamEventTypes.PERMISSION_CHANGED,
        payload: new PermissionChangedEvent(
          userId,
          assignedBy,
          'ASSIGN_ROLE',
          { roleCode },
          new Date().toISOString(),
        ),
        status: 'PENDING',
      });
      outboxEventId = outboxEvent.id;
    });

    if (outboxEventId) {
      await this.permissionService.invalidateUserPermissionCache(userId);
      const priority =
        IamEventPriorities[IamEventTypes.PERMISSION_CHANGED] || 5;
      await this.outboxQueue.add(
        'process_event',
        { eventId: outboxEventId },
        { priority },
      );
      this.logger.debug(`Assigned role ${roleCode} to user ${userId}`);
    }
  }

  async removeRole(
    userId: string,
    roleCode: string,
    removedBy: string,
    adminIp: string,
  ): Promise<void> {
    const userExists = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!userExists) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    if (userId === removedBy) {
      throw new BadRequestException(
        'Administrators cannot remove roles from themselves',
      );
    }

    const role = await this.roleRepository.findOne({
      where: { code: roleCode },
    });
    if (!role) {
      throw new NotFoundException(`Role ${roleCode} not found`);
    }

    let outboxEventId: string | null = null;

    await this.dataSource.transaction(async (manager) => {
      const userRoleRepo = manager.getRepository(UserRoleEntity);
      const outboxRepo = manager.getRepository(IamOutboxEntity);

      const existing = await userRoleRepo.findOne({
        where: { userId, roleId: role.id },
      });
      if (!existing) {
        return;
      }

      await userRoleRepo.delete({ userId, roleId: role.id });

      const auditRepo = manager.getRepository(RoleAuditLogEntity);
      await auditRepo.save({
        userId: removedBy,
        action: 'REMOVE_ROLE',
        target: userId,
        payload: { roleCode },
        ipAddress: adminIp,
      });

      const outboxEvent = await outboxRepo.save({
        eventType: IamEventTypes.PERMISSION_CHANGED,
        payload: new PermissionChangedEvent(
          userId,
          removedBy,
          'REMOVE_ROLE',
          { roleCode },
          new Date().toISOString(),
        ),
        status: 'PENDING',
      });
      outboxEventId = outboxEvent.id;
    });

    if (outboxEventId) {
      await this.permissionService.invalidateUserPermissionCache(userId);
      const priority =
        IamEventPriorities[IamEventTypes.PERMISSION_CHANGED] || 5;
      await this.outboxQueue.add(
        'process_event',
        { eventId: outboxEventId },
        { priority },
      );
      this.logger.debug(`Removed role ${roleCode} from user ${userId}`);
    }
  }
}
