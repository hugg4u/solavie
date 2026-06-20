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
    return new Promise<void>((resolve, reject) => {
      const stream = this.redisClient.scanStream({
        match: 'iam:user_permissions:*',
        count: 100,
      });

      let isSettled = false;

      stream.on('data', (keys: string[]) => {
        if (keys.length > 0) {
          stream.pause();
          this.redisClient
            .del(...keys)
            .then(() => {
              stream.resume();
            })
            .catch((err) => {
              if (!isSettled) {
                isSettled = true;
                stream.destroy();
                reject(err instanceof Error ? err : new Error(String(err)));
              }
            });
        }
      });

      stream.on('end', () => {
        if (!isSettled) {
          isSettled = true;
          resolve();
        }
      });

      stream.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }
}
