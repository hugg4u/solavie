import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import * as jsonLogic from 'json-logic-js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { UserRoleEntity } from '../entities/user-role.entity';
import { REDIS_CACHE_CLIENT } from '../../../core/redis/redis.module';
import { ConfigService } from '@nestjs/config';
import { IamRedisKeys } from '../constants/iam.constants';
import { AuthenticatedRequest } from '../interfaces/request.interface';
import { ResourceHydratorRegistry } from '../../../core/database/resource-hydrator.registry';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private reflector: Reflector,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepository: Repository<UserRoleEntity>,
    @Inject(REDIS_CACHE_CLIENT)
    private readonly redisClient: Redis,
    private readonly configService: ConfigService,
    private readonly hydratorRegistry: ResourceHydratorRegistry,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user || !user.id) {
      return false;
    }

    const userId = user.id;

    // 1. Super Admin Bypass (bằng ID cấu hình trong env)
    const superAdminId = this.configService.get<string>('SUPER_ADMIN_ID');
    if (superAdminId && userId === superAdminId) {
      return true;
    }

    let userPermissions: Record<string, true | Record<string, any>[]> = {};

    const cacheKey = `${IamRedisKeys.USER_PERMISSIONS}${userId}`;
    let cachedData: string | null = null;
    try {
      cachedData = await this.redisClient.get(cacheKey);
    } catch (err) {
      this.logger.error(
        `Failed to read permissions cache for user ${userId}`,
        err,
      );
    }

    if (cachedData) {
      userPermissions = JSON.parse(cachedData) as Record<
        string,
        true | Record<string, any>[]
      >;
    } else {
      const userRoles = await this.userRoleRepository.find({
        where: { userId },
        relations: {
          role: {
            policies: {
              permission: true,
            },
          },
        },
      });

      // Kiểm tra nếu user có role SUPER_ADMIN
      const hasSuperAdminRole = userRoles.some(ur => ur.role && ur.role.code === 'SUPER_ADMIN');
      if (hasSuperAdminRole) {
        userPermissions['SUPER_ADMIN'] = true;
      }

      userRoles.forEach((ur) => {
        if (ur.role && ur.role.policies) {
          ur.role.policies.forEach((policy) => {
            if (policy.permission) {
              const code = policy.permission.action;
              const rule = policy.ruleExpression;
              if (!userPermissions[code]) {
                userPermissions[code] = rule ? [rule] : true;
              } else if (userPermissions[code] !== true) {
                if (!rule) {
                  userPermissions[code] = true;
                } else {
                  const arr = userPermissions[code];
                  if (Array.isArray(arr)) {
                    arr.push(rule);
                  }
                }
              }
            }
          });
        }
      });

      // Cache TTL from env (default 1 hour)
      const ttlStr = this.configService.get<string>('PERMISSION_CACHE_TTL');
      const ttl = ttlStr ? parseInt(ttlStr, 10) : 3600;
      try {
        await this.redisClient.set(
          cacheKey,
          JSON.stringify(userPermissions),
          'EX',
          ttl,
        );
      } catch (err) {
        this.logger.error(
          `Failed to write permissions cache for user ${userId}`,
          err,
        );
      }
    }

    // 2. Super Admin Bypass (bằng Role SUPER_ADMIN đã được lưu trong cache/DB)
    if (userPermissions['SUPER_ADMIN'] === true) {
      return true;
    }

    // 3. Dynamic ABAC Resource Hydration
    let hydratedResource: Record<string, any> | null = null;
    const params = request.params as Record<string, any> | undefined;
    const body = request.body as Record<string, any> | undefined;
    const query = request.query as Record<string, any> | undefined;
    const resourceId = params?.id || body?.id || body?.resourceId || query?.id || query?.resourceId;

    if (resourceId && typeof resourceId === 'string') {
      for (const permission of requiredPermissions) {
        const lastDotIndex = permission.lastIndexOf('.');
        if (lastDotIndex > 0) {
          const resourcePrefix = permission.substring(0, lastDotIndex);
          const hydrator = this.hydratorRegistry.get(resourcePrefix);
          if (hydrator) {
            try {
              hydratedResource = await hydrator.fetchResource(resourceId);
              if (hydratedResource) {
                break; // Tải thành công tài nguyên từ Hydrator đầu tiên phù hợp
              }
            } catch (err) {
              this.logger.error(`Error hydrating resource ${resourceId} for prefix ${resourcePrefix}`, err);
            }
          }
        }
      }
    }

    const contextData = {
      user: request.user,
      params: (request.params as Record<string, unknown>) || {},
      query: (request.query as Record<string, unknown>) || {},
      body: (request.body as Record<string, unknown>) || {},
      resource: hydratedResource, // Nạp đối tượng tài nguyên ABAC
    };

    return requiredPermissions.every((permission) => {
      const policy = userPermissions[permission];
      if (!policy) return false;
      if (policy === true) return true;

      // At least one rule must evaluate to true (OR logic across policies)
      return policy.some((ruleObj) => {
        try {
          return jsonLogic.apply(ruleObj as jsonLogic.RulesLogic, contextData);
        } catch {
          return false;
        }
      });
    });
  }
}
