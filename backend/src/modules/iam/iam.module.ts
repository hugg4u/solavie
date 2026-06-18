import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { UserEntity } from './entities/user.entity';
import { RoleEntity } from './entities/role.entity';
import { PermissionEntity } from './entities/permission.entity';
import { UserRoleEntity } from './entities/user-role.entity';
import { PolicyEntity } from './entities/policy.entity';
import { IamOutboxEntity } from './entities/iam-outbox.entity';
import { RoleAuditLogEntity } from './entities/role-audit-log.entity';
import { IamDeviceHistoryEntity } from './entities/device-history.entity';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { PermissionService } from './services/permission.service';
import { JwtStrategy } from './guards/jwt.strategy';
import { IamOutboxWorker } from './workers/outbox.worker';
import { IamOutboxProcessor } from './processors/outbox.processor';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      RoleEntity,
      PermissionEntity,
      UserRoleEntity,
      PolicyEntity,
      IamOutboxEntity,
      RoleAuditLogEntity,
      IamDeviceHistoryEntity,
    ]),
    BullModule.registerQueue({
      name: 'iam_outbox',
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
    JwtStrategy,
    IamOutboxWorker,
    IamOutboxProcessor,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
  controllers: [AuthController],
  exports: [TypeOrmModule, JwtModule],
})
export class IamModule {}
