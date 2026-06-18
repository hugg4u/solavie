import { Global, Module } from '@nestjs/common';
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
        return new Redis(configService.get<string>('REDIS_CACHE_URL')!);
      },
    },
    {
      provide: REDIS_QUEUE_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return new Redis(configService.get<string>('REDIS_QUEUE_URL')!);
      },
    },
  ],
  exports: [REDIS_CACHE_CLIENT, REDIS_QUEUE_CLIENT],
})
export class RedisModule {}
