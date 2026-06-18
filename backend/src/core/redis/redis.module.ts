import { Global, Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CACHE_CLIENT = 'REDIS_CACHE_CLIENT';
export const REDIS_QUEUE_CLIENT = 'REDIS_QUEUE_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CACHE_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('RedisCacheClient');
        const client = new Redis(configService.get<string>('REDIS_CACHE_URL')!);
        client.on('error', (err) =>
          logger.error('Redis Cache Connection Error', err),
        );
        client.on('connect', () => logger.log('Connected to Redis Cache'));
        return client;
      },
    },
    {
      provide: REDIS_QUEUE_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('RedisQueueClient');
        const client = new Redis(configService.get<string>('REDIS_QUEUE_URL')!);
        client.on('error', (err) =>
          logger.error('Redis Queue Connection Error', err),
        );
        client.on('connect', () => logger.log('Connected to Redis Queue'));
        return client;
      },
    },
  ],
  exports: [REDIS_CACHE_CLIENT, REDIS_QUEUE_CLIENT],
})
export class RedisModule {}
