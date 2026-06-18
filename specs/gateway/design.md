# Thiết Kế Kiến Trúc Module Gateway (Design)

## 1. Lựa Chọn Công Nghệ (Tech Stack)
- Sử dụng NestJS + Fastify Module. Fastify mang lại hiệu năng cao (throughput lớn) vượt trội so với Express, phù hợp xử lý hàng chục ngàn request/s.
- Redis Queue (BullMQ): Dùng làm Message Broker (Đệm tin nhắn).

## 2. Thiết Kế Database (Lược Đồ Quan Hệ)

### 2.1. Bảng `gw_channel_configurations` (Cấu Hình Webhook Kênh)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | |
| `channel_type` | VARCHAR(50) | `FACEBOOK`, `ZALO` |
| `credentials` | TEXT | JSON credentials đã được mã hóa đối xứng AES-256-GCM |
| `encryption_iv` | VARCHAR(50) | Vector khởi tạo (Initialization Vector) dùng để giải mã |
| `encryption_tag`| VARCHAR(50) | Thẻ xác thực (Auth Tag) để xác minh tính toàn vẹn của dữ liệu mã hóa |

### 2.2. Bảng `gw_llm_providers` (Cấu hình API Keys của hãng LLM)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | Định danh cấu hình |
| `name` | VARCHAR(100) | Tên gợi nhớ (VD: "OpenAI Chính") |
| `provider_type` | VARCHAR(50) | Loại hãng (`openai`, `gemini`...) |
| `api_key` | TEXT | API Key (được mã hóa AES-256-GCM) |
| `api_base` | VARCHAR(255) | Endpoint custom URL |
| `priority` | INTEGER | Độ ưu tiên (1 là cao nhất) |
| `status` | VARCHAR(30) | `ACTIVE`, `OUT_OF_CREDIT`, `INACTIVE` |

### 2.3. Bảng `gw_llm_provider_models` (Model đồng bộ từ LiteLLM)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | Định danh model |
| `provider_id` | UUID (FK) | Trỏ đến `gw_llm_providers.id` |
| `model_name` | VARCHAR(100) | Tên model kỹ thuật (VD: `gpt-4o-mini`) |
| `model_tier` | VARCHAR(20) | Phân lớp (`LARGE` hoặc `SMALL`) |
| `max_tokens` | INTEGER | Context Window |
| `input_cost_per_token`| NUMERIC(15, 12)| Giá token đầu vào |
| `output_cost_per_token`| NUMERIC(15, 12)| Giá token đầu ra |
| `is_active` | BOOLEAN | |

### 2.4. Bảng `gw_llm_usecases` (Cấu hình Model theo tính năng)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | |
| `usecase_key` | VARCHAR(50) | Khóa kịch bản (`AGENT_CHAT`, `QUERY_REWRITE`...) |
| `required_tier` | VARCHAR(20) | Tier khuyến nghị (`LARGE` / `SMALL`) |
| `provider_model_id`| UUID (FK) | Chỉ định Model cứng (nullable) |

### 2.5. Bảng `gw_llm_metrics` (Nhật ký chi phí & thời gian chạy AI)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | |
| `conversation_id`| UUID | Soft link tới cuộc trò chuyện |
| `usecase_key` | VARCHAR(50) | Khóa kịch bản |
| `provider_id` | UUID (FK) | Trỏ đến provider |
| `model_name` | VARCHAR(100) | Model thực tế sử dụng |
| `prompt_tokens` | INTEGER | Token đầu vào |
| `completion_tokens`| INTEGER | Token đầu ra |
| `cached_tokens` | INTEGER | Token cache |
| `input_cost` | NUMERIC(15, 12)| Chi phí đầu vào |
| `output_cost` | NUMERIC(15, 12)| Chi phí đầu ra |
| `total_cost` | NUMERIC(15, 12)| Tổng chi phí |
| `latency_ms` | INTEGER | Thời gian chạy |


### 2.6. Bảng `gw_incoming_events` (Đệm Outbox Webhook)
Bảng này đóng vai trò lưu trữ lâu bền (Durability Store) theo mô hình Transactional Outbox Pattern để chống mất mát tin nhắn khi hệ thống hàng đợi Redis/BullMQ bị sập.


| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Định danh sự kiện duy nhất |
| `channel` | VARCHAR(50) | NOT NULL | Kênh nhận (`FACEBOOK`, `ZALO`) |
| `payload` | JSONB | NOT NULL | Raw webhook payload nhận được từ đối tác |
| `status` | VARCHAR(20) | Default 'PENDING' | Trạng thái: `PENDING` (Đang chờ), `PROCESSED` (Đã xử lý), `FAILED` (Thất bại) |
| `retry_count` | INTEGER | Default 0 | Số lần thử đẩy lại vào hàng đợi |
| `created_at` | TIMESTAMP | Default NOW() | Thời điểm nhận webhook |
| `updated_at` | TIMESTAMP | Default NOW() | Thời điểm cập nhật trạng thái gần nhất |

*Đánh chỉ mục (Index):*
- Cột `status` và `created_at` đánh index phức hợp `idx_gw_events_status_created` để tối ưu hóa truy vấn cho Background Worker.

### 2.7. Bảng `gw_prompt_variables` (Quản lý biến prompt động của Admin)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | Định danh duy nhất |
| `variable_key` | VARCHAR(50) (UK) | Khóa biến kỹ thuật |
| `variable_value` | TEXT | Nội dung biến cấu hình |
| `description` | TEXT | Mô tả công dụng |
| `updater_id` | UUID | Soft link `iam_users.id` |
| `updated_at` | TIMESTAMP | |

---

## 3. Contract Chuẩn Hóa Tin Nhắn (UnifiedMessage)
Mọi tin nhắn gửi vào Redis Queue đều phải tuân theo cấu trúc DTO này:
```typescript
export interface UnifiedMessage {
  messageId: string;       // ID tin nhắn gốc
  channel: string;         // FACEBOOK hoặc ZALO
  senderId: string;        // ID người gửi (PSID)
  recipientId: string;     // ID trang nhận
  type: string;            // TEXT, IMAGE, DOCUMENT
  content: string;         // Nội dung
  timestamp: number;       // Thời gian (Unix epoch)
}
```

---

## 4. Thiết Kế Cơ Chế Mã Hóa AES-256-GCM
Để bảo vệ an toàn cho các tokens/keys nhạy cảm, hệ thống sử dụng thuật toán **AES-256-GCM** để mã hóa:
- **Khóa mã hóa (Encryption Key):** Dài 256-bit (32 bytes), được cung cấp qua biến môi trường `SYSTEM_ENCRYPTION_KEY`. Cấm tuyệt đối việc lưu key trong code hay Database.
- **IV (Initialization Vector):** Sinh ngẫu nhiên (12 bytes) cho mỗi lần mã hóa, lưu vào cột `encryption_iv` dưới dạng hex.
- **Auth Tag:** Sinh tự động từ thuật toán GCM (16 bytes), lưu vào cột `encryption_tag` dưới dạng hex để chống việc giả mạo dữ liệu đã mã hóa.

---

## 5. Thiết Kế Hạ Tầng Redis & BullMQ (Isolation, Sharing & Cleanup)

Để đảm bảo khả năng chịu tải và độ tin cậy của hàng đợi tin nhắn, Gateway áp dụng các quy chuẩn thiết kế hạ tầng sau:

### 5.1. Quy hoạch Instance Redis (Redis Isolation)
Hệ thống sử dụng hai đường kết nối Redis riêng biệt để cô lập lỗi:
1.  **Cache Connection (`REDIS_CACHE_URL`):** Kết nối tới instance Redis chuyên dùng làm cache phân quyền cho IAM. Sử dụng chính sách giải phóng bộ nhớ `maxmemory-policy allkeys-lru` để tự động dọn key cũ khi bộ nhớ đầy.
2.  **Queue Connection (`REDIS_QUEUE_URL`):** Kết nối tới instance Redis chuyên dụng cho hàng đợi BullMQ và khóa phân tán (Redis Locks). **Bắt buộc cấu hình chính sách `maxmemory-policy noeviction`** (trả về lỗi `OOM command not allowed` khi đầy bộ nhớ thay vì tự ý xóa key) để đảm bảo không bị mất job hàng đợi và cờ lock.

### 5.2. Chia sẻ Kết nối Client (Connection Pooling/Sharing)
Mỗi instance Gateway khởi chạy chỉ được tạo tối đa 3 kết nối TCP tới Redis cho BullMQ:
- 1 kết nối cho Queue Producer (đẩy tin nhắn).
- 1 kết nối cho Queue Worker (nhận và xử lý tin nhắn).
- 1 kết nối cho Queue Events (lắng nghe trạng thái).

Tất cả các định nghĩa Queue trong NestJS phải tái sử dụng chung một đối tượng Client của thư viện `ioredis` thay vì tự khởi tạo kết nối độc lập.

### 5.3. Cấu hình giải phóng Job mặc định (BullMQ Job Retention Policy)
Mỗi Job đẩy vào hàng đợi Gateway được cấu hình tự động dọn dẹp để bảo vệ dung lượng bộ nhớ RAM:
- `removeOnComplete`: `{ age: 3600, count: 100 }` (Tự động xóa khỏi Redis sau 1 giờ hoặc chỉ giữ lại tối đa 100 jobs gần nhất).
- `removeOnFail`: `{ age: 86400, count: 500 }` (Giữ lại tối đa 500 jobs bị lỗi trong vòng 24 giờ để quản trị viên kiểm tra lỗi, sau đó tự động xóa).

---

## 6. API Endpoints Quản lý Provider (Gateway Providers API)

### 6.1. DTO Contracts & Endpoints

#### 1. API Lấy danh sách hãng LLM được hỗ trợ
*   **Method & Route:** `GET /api/v1/gateway/providers/supported`
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('gateway:read')`
*   **Response DTO (`SupportedProviderDto`):**
    ```typescript
    export class SupportedProviderDto {
      provider_type: string;     // Loại hãng (VD: 'openai', 'anthropic')
      name: string;              // Tên hiển thị (VD: 'OpenAI', 'Anthropic')
      caching_group: string;     // Nhóm Prompt Caching ('APC', 'EXPLICIT_FLAGS', 'CONTEXT_CACHING_API', 'CUSTOM_CACHING')
      description: string;       // Mô tả ngắn
    }
    ```

#### 2. API Lấy danh sách cấu hình provider trong DB
*   **Method & Route:** `GET /api/v1/gateway/providers/configured`
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('gateway:read')`
*   **Response DTO (`ConfiguredProviderDto`):**
    ```typescript
    export class ConfiguredProviderDto {
      id: string;                // UUID định danh
      name: string;              // Tên gợi nhớ
      provider_type: string;     // Loại hãng
      api_base: string | null;   // Endpoint URL custom
      priority: number;          // Độ ưu tiên
      status: string;            // Trạng thái ('ACTIVE', 'OUT_OF_CREDIT', 'INACTIVE')
      updated_at: Date;          // Thời gian cập nhật gần nhất
    }
    ```
    *Lưu ý bảo mật:* DTO tuyệt đối loại bỏ trường `api_key` hoặc chỉ hiển thị mask (VD: `sk-...****`) để ngăn chặn rò rỉ credential lên giao diện.

### 6.2. Cơ chế Cache Redis & Invalidation
*   **Cache Key:** `gateway:providers:configured`
*   **Cache Store:** `REDIS_CACHE_URL` (dùng chung với cache phân quyền IAM).
*   **TTL:** 300 giây (5 phút).
*   **Luồng hoạt động của Cache:**
    1. Khi gọi API `GET /configured`, hệ thống kiểm tra sự tồn tại của cache key trong Redis.
    2. Nếu cache hit: Parse và trả về mảng `ConfiguredProviderDto[]` lập tức mà không gọi DB.
    3. Nếu cache miss: Truy vấn PostgreSQL, map kết quả sang DTO, ghi vào cache Redis với TTL 300s, sau đó trả về cho client.
    4. **Cache Invalidation:** Khi có bất kỳ sự thay đổi cấu hình nào (`POST/PATCH/DELETE` provider) từ phía Admin, hoặc khi hệ thống tự động đổi status sang `OUT_OF_CREDIT` / cách ly `cooldown` trong NestJS Interceptor, hệ thống bắt buộc kích hoạt lệnh xóa cache key:
       ```typescript
       await this.redisClient.del('gateway:providers:configured');
       ```

---

## 7. API Endpoints Quản lý Prompt Variables (Admin Portal)

### 7.1. API Endpoints & DTO Contracts

#### 1. API Tạo hoặc Cập nhật biến Prompt
*   **Method & Route:** `POST /api/v1/gateway/prompts/variables`
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('prompt:write')`
*   **Request DTO (`UpsertPromptVariableDto`):**
    ```typescript
    export class UpsertPromptVariableDto {
      @IsString()
      @IsNotEmpty()
      @Matches(/^[a-zA-Z0-9_]{3,50}$/, { message: 'variable_key must be alphanumeric and underscores only, length 3-50' })
      variable_key: string;

      @IsString()
      @IsNotEmpty()
      variable_value: string;

      @IsString()
      @IsOptional()
      description?: string;
    }
    ```
*   **Zod Safety Check (Prompt Injection Guard):**
    Trước khi lưu vào DB, validation schema sử dụng Zod để lọc đầu vào. Nếu `variable_value` chứa các từ khóa đe dọa (ví dụ: `ignore previous instructions`, `developer mode`, `bypass guardrails`), API sẽ trả về lỗi `400 Bad Request` với thông báo `"Inappropriate prompt instruction detected."` để bảo vệ hệ thống.

#### 2. API Lấy tất cả biến prompt đang hoạt động
*   **Method & Route:** `GET /api/v1/gateway/prompts/variables`
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('prompt:read')`
*   **Response DTO (`PromptVariableDto`):**
    ```typescript
    export class PromptVariableDto {
      id: string;
      variable_key: string;
      variable_value: string;
      description: string | null;
      updated_at: Date;
      updater_name: string | null;
    }
    ```

### 7.2. Cơ chế Cache Redis & Invalidation
*   **Cache Key:** `gateway:prompts:variables`
*   **Cache Store:** `REDIS_CACHE_URL`
*   **TTL:** 300 giây (5 phút).
*   **Invalidation Flow:**
    *   Khi Admin cập nhật biến qua `POST /variables`, backend lưu DB thành công sẽ xóa cache:
        ```typescript
        await this.redisClient.del('gateway:prompts:variables');
        ```
    *   Lần hội thoại tiếp theo của Chatbot gặp cache miss, tự động tải lại các biến mới nhất từ PostgreSQL và cache lại vào Redis.

