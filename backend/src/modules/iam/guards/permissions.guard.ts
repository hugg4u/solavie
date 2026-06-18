/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
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

@Injectable()
export class PermissionsGuard implements CanActivate {
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

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || !user.id) {
      return false;
    }

    const userId = user.id;
    let userPermissions: Record<string, true | string[]> = {};

    const cacheKey = `iam:user_permissions:${userId}`;
    const cachedData = await this.redisClient.get(cacheKey);

    if (cachedData) {
      userPermissions = JSON.parse(cachedData);
    } else {
      const result = await this.userRoleRepository
        .createQueryBuilder('ur')
        .innerJoin('ur.role', 'role')
        .innerJoin('role.policies', 'policy')
        .innerJoin('policy.permission', 'permission')
        .where('ur.user_id = :userId', { userId })
        .select(['permission.code as code', 'policy.rule_expression as rule'])
        .getRawMany();

      result.forEach((r) => {
        const { code, rule } = r;
        if (!userPermissions[code]) {
          userPermissions[code] = rule ? [rule] : true;
        } else if (userPermissions[code] !== true) {
          if (!rule) {
            userPermissions[code] = true;
          } else {
            userPermissions[code].push(rule);
          }
        }
      });

      // Cache TTL from env (default 1 hour)
      const ttl =
        this.configService.get<number>('PERMISSION_CACHE_TTL') || 3600;
      await this.redisClient.set(
        cacheKey,
        JSON.stringify(userPermissions),
        'EX',
        ttl,
      );
    }

    const contextData = {
      user: request.user,
      params: request.params,
      query: request.query,
      body: request.body,
    };

    return requiredPermissions.every((permission) => {
      const policy = userPermissions[permission];
      if (!policy) return false;
      if (policy === true) return true;

      // At least one rule must evaluate to true (OR logic across policies)
      return policy.some((ruleStr) => {
        try {
          const ruleObj = JSON.parse(ruleStr);
          return jsonLogic.apply(ruleObj, contextData);
        } catch (e) {
          return false;
        }
      });
    });
  }
}
