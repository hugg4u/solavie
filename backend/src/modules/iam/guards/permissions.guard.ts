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
    let userPermissions: Record<string, true | string[]> = {};

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
        true | string[]
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

    const contextData = {
      user: request.user,
      params: (request.params as Record<string, unknown>) || {},
      query: (request.query as Record<string, unknown>) || {},
      body: (request.body as Record<string, unknown>) || {},
    };

    return requiredPermissions.every((permission) => {
      const policy = userPermissions[permission];
      if (!policy) return false;
      if (policy === true) return true;

      // At least one rule must evaluate to true (OR logic across policies)
      return policy.some((ruleStr) => {
        try {
          const ruleObj = JSON.parse(ruleStr) as jsonLogic.RulesLogic;
          return jsonLogic.apply(ruleObj, contextData);
        } catch {
          return false;
        }
      });
    });
  }
}
