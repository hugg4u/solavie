import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { UserEntity } from './entities/user.entity';
import { UserSettingEntity } from './entities/user-setting.entity';
import { RoleEntity } from './entities/role.entity';
import { PermissionEntity } from './entities/permission.entity';
import { UserRoleEntity } from './entities/user-role.entity';
import { PolicyEntity } from './entities/policy.entity';
import { IamOutboxEntity } from './entities/iam-outbox.entity';
import { RoleAuditLogEntity } from './entities/role-audit-log.entity';
import { IamDeviceHistoryEntity } from './entities/device-history.entity';

import { IamQueues } from './constants/iam.constants';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './controllers/v1/auth.controller';
import { AuthService } from './services/auth.service';
import { PermissionService } from './services/permission.service';
import { RoleService } from './services/role.service';
import { ProfileService } from './services/profile.service';
import { UsersService } from './services/users.service';
import { ProfileController } from './controllers/v1/profile.controller';
import { UsersController } from './controllers/v1/users.controller';
import { RolesController } from './controllers/v1/roles.controller';
import { PermissionsController } from './controllers/v1/permissions.controller';
import { JwtStrategy } from './guards/jwt.strategy';
import { IamOutboxWorker } from './workers/outbox.worker';
import { IamOutboxProcessor } from './processors/outbox.processor';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { BullModule } from '@nestjs/bullmq';
import { IamSeedService } from './services/iam-seed.service';


@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      UserSettingEntity,
      RoleEntity,
      PermissionEntity,
      UserRoleEntity,
      PolicyEntity,
      IamOutboxEntity,
      RoleAuditLogEntity,
      IamDeviceHistoryEntity,
    ]),
    BullModule.registerQueue({
      name: IamQueues.OUTBOX,
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: configService.get<number>('JWT_ACCESS_EXPIRES_IN'),
        },
      }),
    }),
  ],
  providers: [
    AuthService,
    PermissionService,
    RoleService,
    ProfileService,
    UsersService,
    JwtStrategy,
    IamOutboxWorker,
    IamOutboxProcessor,
    IamSeedService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
  controllers: [
    AuthController,
    ProfileController,
    UsersController,
    RolesController,
    PermissionsController,
  ],
  exports: [
    TypeOrmModule,
    JwtModule,
    RoleService,
    PermissionService,
    AuthService,
  ],
})
export class IamModule {}
