import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { PermissionEntity } from '../entities/permission.entity';
import { RoleEntity } from '../entities/role.entity';
import { UserEntity } from '../entities/user.entity';
import { UserRoleEntity } from '../entities/user-role.entity';
import { PolicyEntity } from '../entities/policy.entity';
import { ALL_SYSTEM_PERMISSIONS } from '../utils/permission-registry';

@Injectable()
export class IamSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IamSeedService.name);

  constructor(
    @InjectRepository(PermissionEntity)
    private readonly permissionRepo: Repository<PermissionEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap() {
    this.logger.log('Executing IAM Auto-Sync & Seeder...');
    try {
      await this.syncPermissions();
      await this.seedDefaultRoles();
      await this.seedRolePolicies();
      await this.seedSuperAdmin();
      this.logger.log('IAM Auto-Sync & Seeder completed successfully!');
    } catch (err) {
      this.logger.error('Failed to execute IAM Auto-Sync & Seeder', err);
    }
  }

  /**
   * Đồng bộ permissions tĩnh từ Registry trong code vào Database
   */
  private async syncPermissions() {
    const codePermissions = Object.values(ALL_SYSTEM_PERMISSIONS);
    
    // Đọc permissions hiện có trong DB
    const dbPermissions = await this.permissionRepo.find();
    const dbActionList = dbPermissions.map(p => p.action);

    // Lọc ra các permissions mới trong code chưa có trong DB
    const newPermissions = codePermissions.filter(p => !dbActionList.includes(p));

    if (newPermissions.length > 0) {
      const entities = newPermissions.map(p => this.permissionRepo.create({
        action: p,
        description: `Auto-generated permission for action: ${p}`
      }));
      await this.permissionRepo.save(entities);
      this.logger.log(`Auto-synced: Added ${newPermissions.length} new permissions to DB.`);
    }
  }

  /**
   * Tạo các Roles mặc định nếu chưa tồn tại
   */
  private async seedDefaultRoles() {
    const defaultRoles = [
      { code: 'SUPER_ADMIN', name: 'Super Administrator', description: 'Tài khoản tối cao bypass mọi kiểm tra quyền' },
      { code: 'ADMIN', name: 'Administrator', description: 'Quản trị viên vận hành hệ thống' },
      { code: 'MANAGER', name: 'Manager', description: 'Quản lý vận hành dự án & kinh doanh' },
      { code: 'SALES', name: 'Sales Representative', description: 'Nhân viên tư vấn kinh doanh' },
    ];

    for (const roleDef of defaultRoles) {
      const existing = await this.roleRepo.findOne({ where: { code: roleDef.code } });
      if (!existing) {
        const newRole = this.roleRepo.create(roleDef);
        await this.roleRepo.save(newRole);
        this.logger.log(`Auto-seeded default role: [${roleDef.code}]`);
      }
    }
  }

  /**
   * Kiểm tra và tạo tài khoản Super Admin mặc định từ file cấu hình .env
   */
  private async seedSuperAdmin() {
    const id = this.configService.get<string>('SUPER_ADMIN_ID');
    const email = this.configService.get<string>('SUPER_ADMIN_EMAIL');
    const password = this.configService.get<string>('SUPER_ADMIN_PASSWORD');

    if (!id || !email || !password) {
      this.logger.warn('Super Admin configuration missing in environment variables. Seeding bypassed.');
      return;
    }

    // 1. Kiểm tra xem user Super Admin đã tồn tại chưa (theo email hoặc ID)
    const existingUser = await this.userRepo.findOne({
      where: [{ id }, { email }],
    });

    if (existingUser) {
      // Đảm bảo Super Admin User được gán Role SUPER_ADMIN
      await this.ensureSuperAdminRoleMapping(existingUser.id);
      return;
    }

    // 2. Hash mật khẩu của Super Admin
    const passwordHash = await bcrypt.hash(password, 10);

    // 3. Tiến hành tạo Super Admin bằng Database Transaction
    await this.dataSource.transaction(async (manager) => {
      const userRepoTrans = manager.getRepository(UserEntity);
      const userRoleRepoTrans = manager.getRepository(UserRoleEntity);
      const roleRepoTrans = manager.getRepository(RoleEntity);

      // Lấy role SUPER_ADMIN
      const superAdminRole = await roleRepoTrans.findOne({ where: { code: 'SUPER_ADMIN' } });
      if (!superAdminRole) {
        throw new Error('SUPER_ADMIN role must exist before seeding super admin user.');
      }

      // Insert User mới
      const newSuperAdmin = userRepoTrans.create({
        id,
        email,
        fullName: 'System Super Admin',
        passwordHash,
        isActive: true,
      });
      await userRepoTrans.save(newSuperAdmin);

      // Gán Role
      const newMapping = userRoleRepoTrans.create({
        userId: newSuperAdmin.id,
        roleId: superAdminRole.id,
        grantedBy: newSuperAdmin.id, // Tự gán
      });
      await userRoleRepoTrans.save(newMapping);

      this.logger.log(`Successfully seeded Super Admin user: [${email}]`);
    });
  }

  /**
   * Đảm bảo tài khoản Super Admin luôn được gán Role SUPER_ADMIN
   */
  private async ensureSuperAdminRoleMapping(userId: string) {
    const superAdminRole = await this.roleRepo.findOne({ where: { code: 'SUPER_ADMIN' } });
    if (!superAdminRole) return;

    const existingMapping = await this.userRoleRepo.findOne({
      where: { userId, roleId: superAdminRole.id },
    });

    if (!existingMapping) {
      const newMapping = this.userRoleRepo.create({
        userId,
        roleId: superAdminRole.id,
        grantedBy: userId,
      });
      await this.userRoleRepo.save(newMapping);
      this.logger.log(`Super Admin user role mapping restored.`);
    }
  }

  /**
   * Ánh xạ mặc định các Quyền (Permissions) cho từng Vai Trò (Roles)
   */
  private async seedRolePolicies() {
    const allPermissions = await this.permissionRepo.find();
    const permMap = new Map(allPermissions.map(p => [p.action, p]));

    const adminRole = await this.roleRepo.findOne({ where: { code: 'ADMIN' } });
    const managerRole = await this.roleRepo.findOne({ where: { code: 'MANAGER' } });
    const salesRole = await this.roleRepo.findOne({ where: { code: 'SALES' } });

    // ADMIN có tất cả mọi quyền trong hệ thống
    if (adminRole) {
      const adminPermActions = allPermissions.map(p => p.action);
      await this.assignPermissionsToRole(adminRole.id, adminPermActions, permMap);
    }

    // MANAGER có quyền xem/sửa người dùng, xem roles & permissions
    if (managerRole) {
      const managerPermActions = [
        'iam.users.read',
        'iam.users.create',
        'iam.users.update',
        'iam.roles.read',
        'iam.permissions.read'
      ];
      await this.assignPermissionsToRole(managerRole.id, managerPermActions, permMap);
    }

    // SALES chỉ có quyền xem thông tin người dùng
    if (salesRole) {
      const salesPermActions = [
        'iam.users.read'
      ];
      await this.assignPermissionsToRole(salesRole.id, salesPermActions, permMap);
    }
  }

  private async assignPermissionsToRole(roleId: string, actions: string[], permMap: Map<string, PermissionEntity>) {
    await this.dataSource.transaction(async (manager) => {
      const policyRepo = manager.getRepository(PolicyEntity);

      for (const action of actions) {
        const permission = permMap.get(action);
        if (!permission) continue;

        const existingPolicy = await policyRepo.findOne({
          where: { roleId, permissionId: permission.id }
        });

        if (!existingPolicy) {
          const newPolicy = policyRepo.create({
            roleId,
            permissionId: permission.id,
            ruleExpression: null // Quyền tĩnh RBAC mặc định
          });
          await policyRepo.save(newPolicy);
          this.logger.log(`Mapped permission [${action}] to role ID [${roleId}]`);
        }
      }
    });
  }
}
