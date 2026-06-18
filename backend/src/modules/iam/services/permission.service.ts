import { Injectable, Inject } from '@nestjs/common';
import { REDIS_CACHE_CLIENT } from '../../../core/redis/redis.module';
import Redis from 'ioredis';

@Injectable()
export class PermissionService {
  constructor(
    @Inject(REDIS_CACHE_CLIENT) private readonly redisClient: Redis,
  ) {}

  async invalidateUserPermissionCache(userId: string): Promise<void> {
    const cacheKey = `iam:user_permissions:${userId}`;
    await this.redisClient.del(cacheKey);
  }

  async invalidateAllPermissionCaches(): Promise<void> {
    const keys = await this.redisClient.keys('iam:user_permissions:*');
    if (keys.length > 0) {
      await this.redisClient.del(...keys);
    }
  }
}
