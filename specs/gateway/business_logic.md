# Đặc Tả Business Logic Module Gateway

## 1. Xác Thực Chữ Ký (Signature Verification)
Bảo vệ hệ thống bằng thuật toán HMAC-SHA256 trên Fastify Middleware.
- **Facebook**: Header `x-hub-signature-256`. Tính băm của raw body bằng App Secret.
- **Zalo OA**: Header `x-ze-signature`. Tính băm chuỗi `appId + rawBody + timestamp` bằng Zalo Secret Key.

## 2. Xử Lý Bất Đồng Bộ & Transactional Outbox (Non-blocking Flow)
Để đảm bảo tin nhắn không bị mất và phản hồi webhook nhanh chóng, Gateway áp dụng quy trình Outbox:
- Nhận HTTP POST Request từ Facebook/Zalo.
- Extract Payload -> Verify Signature (Xem Mục 1).
- **Thực thi trong một Database Transaction:**
  1. Ghi raw webhook payload vào bảng `gw_incoming_events` với trạng thái `PENDING`.
  2. Biến đổi dữ liệu (Transform) thành đối tượng `UnifiedMessage`.
  3. Đẩy đối tượng `UnifiedMessage` vào Redis Queue `msg_queue` (sử dụng BullMQ).
  4. Nếu đẩy thành công, cập nhật trạng thái sự kiện trong DB từ `PENDING` sang `PROCESSED`.
  5. Commit Transaction.
- Trả về ngay lập tức HTTP 200 OK (độ trễ đảm bảo < 100ms).
- Nếu bước 3 bị lỗi (Redis sập), transaction bị rollback, event vẫn ở trạng thái `PENDING` trong DB để worker quét lại.

## 3. Worker Subscribe Queue
- Module Chatbot đóng vai trò Worker, subscribe vào `msg_queue`.
- Pop tin nhắn ra, xử lý Intent, RAG. Sau khi có kết quả sinh Text từ LLM, Worker sẽ gọi API "Send Message" của Facebook/Zalo để gửi tin lại cho khách hàng.

---

## 4. Cơ chế Mã hóa & Giải mã AES-256-GCM
Dịch vụ `GatewayCryptoService` chịu trách nhiệm bảo vệ an toàn cho credentials nhạy cảm:

```typescript
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class GatewayCryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key = Buffer.from(process.env.SYSTEM_ENCRYPTION_KEY, 'hex'); // Khóa 32 bytes

  encrypt(text: string): { encryptedData: string; iv: string; tag: string } {
    const iv = crypto.randomBytes(12); // GCM yêu cầu IV 12 bytes
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag().toString('hex'); // Auth tag 16 bytes

    return {
      encryptedData: encrypted,
      iv: iv.toString('hex'),
      tag: tag,
    };
  }

  decrypt(encryptedData: string, ivHex: string, tagHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}
```

---

## 5. Background Outbox Recovery Worker
Quét dọn và khôi phục các tin nhắn bị kẹt ở trạng thái `PENDING` do sự cố kết nối hàng đợi tạm thời:

```typescript
@Injectable()
export class OutboxRecoveryWorker {
  private readonly logger = new Logger(OutboxRecoveryWorker.name);

  constructor(
    @InjectRepository(GatewayIncomingEvent)
    private readonly eventRepository: Repository<GatewayIncomingEvent>,
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @Interval(30000) // Chạy định kỳ mỗi 30 giây
  async recoverPendingEvents() {
    // Tìm các event PENDING được tạo cách đây hơn 30 giây
    const pendingEvents = await this.eventRepository.find({
      where: {
        status: 'PENDING',
        created_at: LessThan(new Date(Date.now() - 30000)),
        retry_count: LessThan(3) // Giới hạn thử lại tối đa 3 lần
      },
      take: 50 // Limit batch size để tránh nghẽn
    });

    for (const event of pendingEvents) {
      try {
        const unifiedMessage = this.transformToUnifiedMessage(event.payload);
        await this.messageQueueService.pushToQueue(unifiedMessage);
        
        event.status = 'PROCESSED';
        event.updated_at = new Date();
        await this.eventRepository.save(event);
        this.logger.log(`Khôi phục và đẩy lại thành công event ID: ${event.id}`);
      } catch (error) {
        event.retry_count += 1;
        if (event.retry_count >= 3) {
          event.status = 'FAILED';
        }
        event.updated_at = new Date();
        await this.eventRepository.save(event);
        this.logger.error(`Thất bại khi khôi phục event ID: ${event.id}. Lần thử: ${event.retry_count}`, error.stack);
      }
    }
  }
}
```

---

## 6. Cấu hình Khởi tạo BullMQ Queue & Kết nối ioredis (NestJS)

Đặc tả cấu hình dùng chung đối tượng kết nối `ioredis` và thiết lập `defaultJobOptions` dọn dẹp job tự động:

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';

// Khởi tạo một đối tượng kết nối duy nhất dùng chung
const redisQueueConnection = new Redis(process.env.REDIS_QUEUE_URL, {
  maxLoadingRetryTime: 10000,
  enableReadyCheck: true,
});

@Module({
  imports: [
    BullModule.forRoot({
      connection: redisQueueConnection, // Chia sẻ connection pool
      defaultJobOptions: {
        removeOnComplete: {
          age: 3600, // Xóa sau 1 tiếng
          count: 100 // Chỉ giữ tối đa 100 jobs hoàn thành gần nhất
        },
        removeOnFail: {
          age: 86400, // Xóa sau 24 tiếng
          count: 500  // Giữ tối đa 500 jobs thất bại để debug
        },
        attempts: 3, // Thử lại tối đa 3 lần nếu worker trả về lỗi
        backoff: {
          type: 'exponential',
          delay: 1000 // Thử lại sau 1s, 2s, 4s (Exponential Backoff)
        }
      }
    }),
    BullModule.registerQueue({
      name: 'msg_queue'
    })
  ]
})
export class GatewayQueueModule {}
```

---

## 7. Logic CRUD Provider & Cache Management (Gateway Providers Business Logic)

Đặc tả mã nguồn NestJS Service quản lý danh sách LLM Providers, xử lý cache Redis và che giấu credential API Key:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { LlmProvider } from './entities/llm-provider.entity';
import { SupportedProviderDto, ConfiguredProviderDto } from './dto/provider.dto';

@Injectable()
export class GatewayProvidersService {
  private readonly CACHE_KEY = 'gateway:providers:configured';
  private readonly CACHE_TTL = 300; // 5 phút

  // Danh sách hãng tĩnh hỗ trợ Prompt Caching
  private readonly supportedProvidersList: SupportedProviderDto[] = [
    {
      provider_type: 'openai',
      name: 'OpenAI',
      caching_group: 'APC',
      description: 'Automatic Prefix Caching (Tự động cache tiền tố tĩnh từ 1024 tokens)'
    },
    {
      provider_type: 'deepseek',
      name: 'DeepSeek',
      caching_group: 'APC',
      description: 'Automatic Prefix Caching (Tối ưu hóa chi phí cực sâu từ DeepSeek)'
    },
    {
      provider_type: 'google',
      name: 'Google Gemini',
      caching_group: 'CONTEXT_CACHING_API',
      description: 'Context Caching API (Tạo cache resource tĩnh cho ngữ cảnh >= 32,768 tokens)'
    },
    {
      provider_type: 'anthropic',
      name: 'Anthropic (Claude)',
      caching_group: 'EXPLICIT_FLAGS',
      description: 'Explicit Caching Flags (Yêu cầu chèn cờ cache_control)'
    },
    {
      provider_type: 'groq',
      name: 'Groq',
      caching_group: 'APC',
      description: 'Automatic Prefix Caching (Tốc độ xử lý siêu cao, cache tự động)'
    },
    {
      provider_type: 'together_ai',
      name: 'Together AI',
      caching_group: 'APC',
      description: 'Automatic Prefix Caching (Nền tảng open-source đa mô hình)'
    },
    {
      provider_type: 'openrouter',
      name: 'OpenRouter',
      caching_group: 'EXPLICIT_FLAGS',
      description: 'Explicit Caching Flags (Định tuyến linh hoạt, hỗ trợ cờ cache qua Anthropic)'
    },
    {
      provider_type: 'qwen',
      name: 'Qwen (Alibaba)',
      caching_group: 'APC',
      description: 'Automatic Prefix Caching (Mô hình ngôn ngữ lớn mạnh mẽ từ Trung Quốc)'
    },
    {
      provider_type: 'mistral',
      name: 'Mistral AI',
      caching_group: 'APC',
      description: 'Automatic Prefix Caching (Mô hình châu Âu thông minh)'
    },
    {
      provider_type: 'azure',
      name: 'Microsoft Azure OpenAI',
      caching_group: 'APC',
      description: 'Automatic Prefix Caching (Môi trường bảo mật cấp doanh nghiệp)'
    },
    {
      provider_type: 'xai',
      name: 'xAI Grok',
      caching_group: 'APC',
      description: 'Automatic Prefix Caching (Mô hình Grok thông tin thời gian thực)'
    },
    {
      provider_type: 'bedrock',
      name: 'Amazon Bedrock',
      caching_group: 'EXPLICIT_FLAGS',
      description: 'Explicit Caching Flags (Bedrock Converse API với cờ cachePoint)'
    },
    {
      provider_type: 'vertex_ai',
      name: 'Google Cloud Vertex AI',
      caching_group: 'CONTEXT_CACHING_API',
      description: 'Context Caching API (Tích hợp đám mây Vertex AI)'
    },
    {
      provider_type: 'replicate',
      name: 'Replicate',
      caching_group: 'APC',
      description: 'Automatic Prefix Caching (Triển khai open-source serverless)'
    },
    {
      provider_type: 'cohere',
      name: 'Cohere',
      caching_group: 'CUSTOM_CACHING',
      description: 'Custom Caching (Tối ưu hóa preamble & RAG cục bộ)'
    },
    {
      provider_type: 'perplexity',
      name: 'Perplexity',
      caching_group: 'CUSTOM_CACHING',
      description: 'Custom Caching (Khống chế token đầu vào chặt chẽ)'
    },
    {
      provider_type: 'voyage',
      name: 'Voyage AI',
      caching_group: 'CUSTOM_CACHING',
      description: 'Custom Caching (Cache cục bộ embeddings trong Database)'
    }
  ];

  constructor(
    @InjectRepository(LlmProvider)
    private readonly providerRepo: Repository<LlmProvider>,
    @InjectRedis('cache') private readonly redis: Redis, // Sử dụng REDIS_CACHE_URL
  ) {}

  /**
   * 1. Lấy danh sách hãng LLM được hỗ trợ (Tĩnh)
   */
  getSupportedProviders(): SupportedProviderDto[] {
    return this.supportedProvidersList;
  }

  /**
   * 2. Lấy danh sách cấu hình provider (Động - Sử dụng cache Redis)
   */
  async getConfiguredProviders(): Promise<ConfiguredProviderDto[]> {
    // A. Kiểm tra cache Redis
    const cachedData = await this.redis.get(this.CACHE_KEY);
    if (cachedData) {
      return JSON.parse(cachedData);
    }

    // B. Cache miss -> Truy vấn PostgreSQL
    const providers = await this.providerRepo.find({
      order: { priority: 'ASC' }
    });

    // C. Map sang DTO để loại bỏ trường api_key thô
    const dtos: ConfiguredProviderDto[] = providers.map(p => ({
      id: p.id,
      name: p.name,
      provider_type: p.provider_type,
      api_base: p.api_base,
      priority: p.priority,
      status: p.status,
      updated_at: p.updated_at
    }));

    // D. Ghi lại vào cache Redis
    await this.redis.set(this.CACHE_KEY, JSON.stringify(dtos), 'EX', this.CACHE_TTL);

    return dtos;
  }

  /**
   * 3. Giải phóng cache khi có thay đổi dữ liệu (Cache Invalidation)
   */
  async invalidateCache(): Promise<void> {
    await this.redis.del(this.CACHE_KEY);
  }

  /**
   * 4. Thêm mới / Cập nhật cấu hình (Ví dụ ghi dữ liệu)
   */
  async updateProvider(id: string, updateData: Partial<LlmProvider>): Promise<LlmProvider> {
    const provider = await this.providerRepo.findOneBy({ id });
    if (!provider) {
      throw new Error('Provider not found');
    }

    Object.assign(provider, updateData);
    const saved = await this.providerRepo.save(provider);
    
    // Bắt buộc invalidate cache
    await this.invalidateCache();
    return saved;
  }
}
```

---

## 8. Logic Quản lý Prompt Variables & Invalidation Cache

Đặc tả mã nguồn NestJS Service chịu trách nhiệm lưu trữ các biến cấu hình prompt động của Admin, thực hiện quét an ninh chống Prompt Injection và quản lý cache Redis:

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { PromptVariable } from './entities/prompt-variable.entity';
import { UpsertPromptVariableDto, PromptVariableDto } from './dto/prompt-variable.dto';

@Injectable()
export class PromptVariablesService {
  private readonly CACHE_KEY = 'gateway:prompts:variables';
  private readonly CACHE_TTL = 300; // 5 phút

  // Danh sách từ khóa độc hại cấm dùng để ngăn chặn Prompt Injection
  private readonly PROMPT_INJECTION_BLACKLIST = [
    /ignore.*instructions/i,
    /system.*developer.*mode/i,
    /bypass.*guardrails/i,
    /reset.*system.*rules/i,
    /you.*are.*now.*a.*developer/i,
    /translate.*this.*exact.*phrase/i
  ];

  constructor(
    @InjectRepository(PromptVariable)
    private readonly variableRepo: Repository<PromptVariable>,
    @InjectRedis('cache') private readonly redis: Redis, // Sử dụng REDIS_CACHE_URL
  ) {}

  /**
   * 1. Kiểm tra an ninh chống Prompt Injection
   */
  private checkPromptInjection(value: string): void {
    for (const pattern of this.PROMPT_INJECTION_BLACKLIST) {
      if (pattern.test(value)) {
        throw new BadRequestException('Inappropriate prompt instruction detected. Input violates safety policies.');
      }
    }
  }

  /**
   * 2. Tạo hoặc Cập nhật biến prompt (Có quét an ninh và invalidate cache)
   */
  async upsertVariable(dto: UpsertPromptVariableDto, userId: string): Promise<PromptVariable> {
    // A. Quét Prompt Injection
    this.checkPromptInjection(dto.variable_value);

    // B. Tìm biến đã tồn tại theo Key
    let variable = await this.variableRepo.findOneBy({ variable_key: dto.variable_key });

    if (variable) {
      variable.variable_value = dto.variable_value;
      variable.description = dto.description;
      variable.updater_id = userId;
      variable.updated_at = new Date();
    } else {
      variable = this.variableRepo.create({
        variable_key: dto.variable_key,
        variable_value: dto.variable_value,
        description: dto.description,
        updater_id: userId,
      });
    }

    // C. Lưu Database
    const saved = await this.variableRepo.save(variable);

    // D. Invalidate Cache Redis ngay lập tức
    await this.redis.del(this.CACHE_KEY);

    return saved;
  }

  /**
   * 3. Lấy toàn bộ biến prompt đang hoạt động (Sử dụng Cache)
   */
  async getVariables(): Promise<PromptVariableDto[]> {
    // A. Đọc cache Redis
    const cached = await this.redis.get(this.CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }

    // B. Cache miss -> Lấy PostgreSQL (join soft-link để lấy tên người cập nhật)
    const variables = await this.variableRepo.createQueryBuilder('v')
      .leftJoinAndSelect('iam_users', 'u', 'u.id = v.updater_id')
      .select([
        'v.id as id',
        'v.variable_key as variable_key',
        'v.variable_value as variable_value',
        'v.description as description',
        'v.updated_at as updated_at',
        'u.full_name as updater_name'
      ])
      .getRawMany();

    const dtos: PromptVariableDto[] = variables.map(v => ({
      id: v.id,
      variable_key: v.variable_key,
      variable_value: v.variable_value,
      description: v.description,
      updated_at: v.updated_at,
      updater_name: v.updater_name
    }));

    // C. Ghi cache Redis
    await this.redis.set(this.CACHE_KEY, JSON.stringify(dtos), 'EX', this.CACHE_TTL);

    return dtos;
  }
}
```
```


