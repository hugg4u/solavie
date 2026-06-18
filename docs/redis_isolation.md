# Hướng Dẫn Cấu Hình: Cô Lập Redis Hệ Thống (System Redis Isolation)

Tài liệu này hướng dẫn chi tiết cách cấu hình cô lập Redis (Redis Isolation) ở cả tầng DevOps (Hạ tầng Docker) và tầng Backend (NestJS Code) cho toàn bộ hệ thống Solavie, đảm bảo tính bền vững cho hàng đợi và hiệu năng cho bộ đệm.

---

## 1. Nguyên Tắc Thiết Kế (Physical vs Logical Isolation)

Trong môi trường Production, hệ thống Solavie sử dụng Redis cho hai mục đích hoàn toàn khác biệt về tính chất:
1. **Caching & Locks (Chấp nhận bay màu):** Lưu trữ token session, typing lock (5s) của `Agent Inbox`, rate limit. Khi bộ nhớ RAM đầy, các key này **có thể bị xóa** theo thuật toán LRU (`maxmemory-policy: allkeys-lru`) để nhường chỗ cho dữ liệu mới.
2. **BullMQ Job Queues (Không được phép mất):** Lưu trữ các job xử lý tin nhắn, nhắc nhở gửi lại webhook của `Chatbot AI`. Dữ liệu này **tuyệt đối không được phép bị xóa** khi RAM đầy (`maxmemory-policy: noeviction`).

> [!WARNING]
> **Hạn chế của Logical Isolation (DB 0, DB 1 trên cùng 1 Instance):**
> Cấu hình `maxmemory-policy` là cấu hình ở cấp **Instance Redis (Global)**, không thể cấu hình riêng cho từng DB Number. Nếu chạy chung 1 instance:
> * Nếu đặt `allkeys-lru`: BullMQ jobs có nguy cơ bị xóa mất khi RAM đầy -> Mất tin nhắn của khách.
> * Nếu đặt `noeviction`: Khi RAM đầy, Caching/Typing locks sẽ báo lỗi ghi dữ liệu (OOM) -> Sập cổng chat.
>
> **Giải pháp đề xuất:** Sử dụng **Physical Isolation (Cô lập vật lý)** - Chạy 2 Container Redis độc lập trên 2 cổng khác nhau.

---

## 2. Cấu Hình Tầng DevOps (Docker Compose)

DevOps triển khai 2 dịch vụ Redis riêng biệt trong file `docker-compose.yml`:

```yaml
version: '3.8'

services:
  # Instance 1: Dành riêng cho Cache & Locks (Inbox typing, CRM merge lock, Session)
  redis-cache:
    image: redis:7-alpine
    container_name: solavie-redis-cache
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru --requirepass ${REDIS_CACHE_PASSWORD}
    ports:
      - "6379:6379"
    volumes:
      - redis_cache_data:/data
    restart: always

  # Instance 2: Dành riêng cho BullMQ Queues (Hàng đợi tin nhắn Chatbot)
  redis-queue:
    image: redis:7-alpine
    container_name: solavie-redis-queue
    command: redis-server --maxmemory 1gb --maxmemory-policy noeviction --appendonly yes --requirepass ${REDIS_QUEUE_PASSWORD}
    ports:
      - "6380:6379" # Port forwarding ra ngoài host là 6380
    volumes:
      - redis_queue_data:/data
    restart: always

volumes:
  redis_cache_data:
  redis_queue_data:
```

*Giải thích tham số:*
* `--maxmemory-policy allkeys-lru`: Tự động xóa key ít sử dụng nhất khi vượt quá 512MB RAM.
* `--maxmemory-policy noeviction`: Trả về lỗi khi vượt quá 1GB RAM chứ không tự ý xóa key của BullMQ.
* `--appendonly yes`: Kích hoạt ghi log AOF (Append Only File) giúp khôi phục các job hàng đợi 100% nếu container bị sập đột ngột.

---

## 3. Cấu Hình Tầng NestJS Backend

### 3.1. Cấu hình biến môi trường (`.env`)
```env
# Môi trường Local (Sử dụng Database Number logical isolation nếu muốn tiết kiệm tài nguyên)
# REDIS_CACHE_URL=redis://:password@localhost:6379/0
# REDIS_QUEUE_URL=redis://:password@localhost:6379/1

# Môi Môi trường Production (Physical Isolation bắt buộc)
REDIS_CACHE_URL=redis://:cache_pwd@redis-cache:6379/0
REDIS_QUEUE_URL=redis://:queue_pwd@redis-queue:6380/0
```

### 3.2. Cấu hình Redis Module trong NestJS (`AppModule`)
Sử dụng gói `@liaoliaots/nestjs-redis` để quản lý nhiều kết nối (multi-client) qua namespace:

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { RedisModule } from '@liaoliaots/nestjs-redis';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        closeLinkBeforeDestroy: true,
        config: [
          {
            namespace: 'cache',
            url: configService.get<string>('REDIS_CACHE_URL'),
          },
          {
            namespace: 'queue',
            url: configService.get<string>('REDIS_QUEUE_URL'),
          },
        ],
      }),
    }),
  ],
})
export class AppModule {}
```

### 3.3. Tích Hợp Vào BullMQ Module (`ChatbotModule`)
Cấu hình BullModule kết nối trực tiếp đến Instance Queue (`REDIS_QUEUE_URL`):

```typescript
// src/chatbot/chatbot.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.get<string>('REDIS_QUEUE_URL'),
        },
        defaultJobOptions: {
          removeOnComplete: 100, // Chỉ giữ lại 100 jobs thành công gần nhất
          removeOnFail: 500,     // Giữ lại 500 jobs thất bại để debug
          attempts: 3,           // Tự động retry 3 lần nếu sập kết nối
          backoff: {
            type: 'exponential',
            delay: 1000,         // Delay tăng dần (1s, 2s, 4s...)
          },
        },
      }),
    }),
  ],
})
export class ChatbotModule {}
```

### 3.4. Gọi Redis Cache Trong Service Logic (`InboxGateway` / `CrmLock`)
Cách Inject đúng client `cache` bằng decorator `@InjectRedis`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';

@Injectable()
export class TypingLockService {
  constructor(
    @InjectRedis('cache') private readonly redis: Redis // Sử dụng client cache
  ) {}

  async acquireTypingLock(conversationId: string, agentId: string, ttl = 5): Promise<boolean> {
    const key = `lock:typing:conversation:${conversationId}`;
    const result = await this.redis.set(key, agentId, 'EX', ttl, 'NX');
    return result === 'OK';
  }
}
```
