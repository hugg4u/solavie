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
import { PolicyEntity } from '../entities/policy.entity';
import { PermissionEntity } from '../entities/permission.entity';
import { IamOutboxEntity } from '../entities/iam-outbox.entity';
import { PermissionService } from './permission.service';
import { RoleAuditLogEntity } from '../entities/role-audit-log.entity';
import { RoleListQueryDto } from '../dto/role.dto';
import { PaginatedResponseDto } from '../../../core/dto/pagination.dto';
import { TypeOrmQueryHelper } from '../../../core/database/typeorm-query.helper';
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
    @InjectRepository(PolicyEntity)
    private readonly policyRepository: Repository<PolicyEntity>,
    @InjectRepository(PermissionEntity)
    private readonly permissionRepository: Repository<PermissionEntity>,
    private readonly dataSource: DataSource,
    @InjectQueue(IamQueues.OUTBOX) private readonly outboxQueue: Queue,
    private readonly permissionService: PermissionService,
  ) {}

  /**
   * Lấy danh sách Roles hỗ trợ tìm kiếm, sắp xếp, và phân trang
   */
  async findAllRoles(
    query: RoleListQueryDto,
  ): Promise<PaginatedResponseDto<RoleEntity>> {
    const page = query.page || 1;
    const limit = query.limit || 20;

    const dbQuery = this.roleRepository.createQueryBuilder('role');

    TypeOrmQueryHelper.apply(dbQuery, query, {
      alias: 'role',
      searchFields: ['role.code', 'role.name', 'role.description'],
    });

    if (!query.sort) {
      dbQuery.orderBy('role.code', 'ASC');
    }

    const [data, total] = await dbQuery.getManyAndCount();
    return new PaginatedResponseDto(data, total, page, limit);
  }

  /**
   * Xem chi tiết một Role kèm danh sách Policies và Permissions
   */
  async findRoleByCode(code: string): Promise<RoleEntity> {
    const role = await this.roleRepository.findOne({
      where: { code },
      relations: {
        policies: {
          permission: true,
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Role with code ${code} not found`);
    }

    return role;
  }

  /**
   * Tạo mới một vai trò (Role) kèm gán danh sách permissions mặc định ban đầu
   */
  async createRole(
    code: string,
    name: string,
    description?: string,
    permissionIds?: string[],
  ): Promise<RoleEntity> {
    const uppercaseCode = code.toUpperCase().trim();
    const existing = await this.roleRepository.findOne({
      where: { code: uppercaseCode },
    });
    if (existing) {
      throw new BadRequestException(
        `Role with code ${uppercaseCode} already exists`,
      );
    }

    let savedRole: RoleEntity;

    await this.dataSource.transaction(async (manager) => {
      const roleRepo = manager.getRepository(RoleEntity);
      const policyRepo = manager.getRepository(PolicyEntity);
      const permissionRepo = manager.getRepository(PermissionEntity);

      const newRole = roleRepo.create({
        code: uppercaseCode,
        name,
        description,
      });

      savedRole = await roleRepo.save(newRole);

      if (permissionIds && permissionIds.length > 0) {
        for (const permId of permissionIds) {
          const perm = await permissionRepo.findOne({ where: { id: permId } });
          if (!perm) {
            throw new NotFoundException(
              `Permission with ID ${permId} not found`,
            );
          }

          const policy = policyRepo.create({
            roleId: savedRole.id,
            permissionId: permId,
            ruleExpression: null, // Mặc định là quyền tĩnh
          });
          await policyRepo.save(policy);
        }
      }
    });

    return this.findRoleByCode(uppercaseCode);
  }

  /**
   * Cập nhật thông tin vai trò
   */
  async updateRole(
    code: string,
    name?: string,
    description?: string,
  ): Promise<RoleEntity> {
    const role = await this.findRoleByCode(code);

    // Chốt chặn bảo vệ Super Admin
    if (role.code === 'SUPER_ADMIN') {
      throw new BadRequestException(
        'SUPER_ADMIN role is immutable and cannot be updated.',
      );
    }

    if (name) role.name = name;
    if (description !== undefined) role.description = description;

    return this.roleRepository.save(role);
  }

  /**
   * Xóa vai trò (chặn nếu có user đang gán role đó)
   */
  async deleteRole(code: string): Promise<void> {
    const role = await this.findRoleByCode(code);

    // Chốt chặn bảo vệ Super Admin
    if (role.code === 'SUPER_ADMIN') {
      throw new BadRequestException(
        'SUPER_ADMIN role is immutable and cannot be deleted.',
      );
    }

    // Kiểm tra xem có người dùng nào đang liên kết với role này hay không
    const userCount = await this.userRoleRepository.count({
      where: { roleId: role.id },
    });

    if (userCount > 0) {
      throw new BadRequestException(
        `Cannot delete role ${code} because it is currently assigned to ${userCount} user(s).`,
      );
    }

    await this.roleRepository.remove(role);
  }

  /**
   * Gán chính sách (Permission + Rule) cho Role
   */
  async assignPolicyToRole(
    roleCode: string,
    permissionId: string,
    ruleExpression: Record<string, any> | null,
    adminId: string,
    adminIp: string,
  ): Promise<void> {
    const role = await this.findRoleByCode(roleCode);

    // Chốt chặn bảo vệ Super Admin
    if (role.code === 'SUPER_ADMIN') {
      throw new BadRequestException(
        'Policies for SUPER_ADMIN role are hardcoded and cannot be modified.',
      );
    }

    const permission = await this.permissionRepository.findOne({
      where: { id: permissionId },
    });
    if (!permission) {
      throw new NotFoundException(
        `Permission with ID ${permissionId} not found`,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const policyRepo = manager.getRepository(PolicyEntity);

      // Kiểm tra xem mapping đã tồn tại chưa
      let policy = await policyRepo.findOne({
        where: { roleId: role.id, permissionId },
      });

      if (policy) {
        policy.ruleExpression = ruleExpression;
      } else {
        policy = policyRepo.create({
          roleId: role.id,
          permissionId,
          ruleExpression,
        });
      }

      await policyRepo.save(policy);

      // Ghi audit log
      const auditRepo = manager.getRepository(RoleAuditLogEntity);
      await auditRepo.save({
        userId: adminId,
        action: 'ASSIGN_POLICY',
        target: role.id,
        payload: {
          roleCode,
          permissionAction: permission.action,
          ruleExpression,
        },
        ipAddress: adminIp,
      });
    });

    // Xoá cache của toàn bộ người dùng mang vai trò này
    await this.invalidateCacheForRoleUsers(role.id);
  }

  /**
   * Gỡ chính sách (Permission) khỏi Role
   */
  async removePolicyFromRole(
    roleCode: string,
    permissionId: string,
    adminId: string,
    adminIp: string,
  ): Promise<void> {
    const role = await this.findRoleByCode(roleCode);

    // Chốt chặn bảo vệ Super Admin
    if (role.code === 'SUPER_ADMIN') {
      throw new BadRequestException(
        'Policies for SUPER_ADMIN role are hardcoded and cannot be modified.',
      );
    }

    const permission = await this.permissionRepository.findOne({
      where: { id: permissionId },
    });
    if (!permission) {
      throw new NotFoundException(
        `Permission with ID ${permissionId} not found`,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const policyRepo = manager.getRepository(PolicyEntity);
      const policy = await policyRepo.findOne({
        where: { roleId: role.id, permissionId },
      });

      if (!policy) {
        return; // Chưa map thì không cần làm gì
      }

      await policyRepo.remove(policy);

      // Ghi audit log
      const auditRepo = manager.getRepository(RoleAuditLogEntity);
      await auditRepo.save({
        userId: adminId,
        action: 'REMOVE_POLICY',
        target: role.id,
        payload: { roleCode, permissionAction: permission.action },
        ipAddress: adminIp,
      });
    });

    // Xoá cache của toàn bộ người dùng mang vai trò này
    await this.invalidateCacheForRoleUsers(role.id);
  }

  /**
   * Xoá cache của toàn bộ user thuộc một Role cụ thể
   */
  private async invalidateCacheForRoleUsers(roleId: string): Promise<void> {
    const userRoles = await this.userRoleRepository.find({
      where: { roleId },
      select: { userId: true },
    });

    for (const ur of userRoles) {
      await this.permissionService.invalidateUserPermissionCache(ur.userId);
    }

    this.logger.debug(
      `Invalidated permissions cache for ${userRoles.length} users of role ${roleId}`,
    );
  }

  /**
   * Gán vai trò cho người dùng
   */
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

  /**
   * Thu hồi vai trò khỏi người dùng
   */
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

    // Lớp phòng vệ chống tự khóa (Self-Lockout)
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
