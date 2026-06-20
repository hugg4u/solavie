import { Module, Global } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';

import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { LoggerModule } from './logger/logger.module';
import { OutboxModule } from './outbox/outbox.module';

import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { TraceIdInterceptor } from './interceptors/trace-id.interceptor';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { IdempotencyInterceptor } from './interceptors/idempotency.interceptor';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { ResourceHydratorRegistry } from './database/resource-hydrator.registry';

@Global()
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    LoggerModule,
    OutboxModule,
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ ttl: 60, limit: 100 }], // Mặc định 100 requests per 60s
        storage: new ThrottlerStorageRedisService(
          new Redis(config.get<string>('REDIS_CACHE_URL')!),
        ),
      }),
    }),
  ],
  providers: [
    ResourceHydratorRegistry,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TraceIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [ResourceHydratorRegistry],
})
export class CoreModule {}
