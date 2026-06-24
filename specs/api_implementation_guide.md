# Hướng Dẫn Thiết Kế & Lập Trình Chuẩn API (Solavie Platform API Implementation Guide)

Tài liệu này đặc tả quy chuẩn lập trình NestJS API cho toàn bộ hệ thống Solavie, đảm bảo sự nhất quán trong đồng bộ dữ liệu Request/Response và bản địa hóa (i18n) theo mô hình Lai (Hybrid).

---

## 1. Đồng Bộ & Trừu Tượng Hóa Request (Đầu Vào)

Mọi API lấy danh sách (List API) hoặc hỗ trợ phân trang đều phải tuân thủ việc kế thừa và kiểm soát dữ liệu đầu vào chặt chẽ nhằm tránh DoS (OOM) và đảm bảo an toàn kiểu dữ liệu.

### 1.1. Lớp Phân Trang Cơ Sở `PaginationQueryDto`
Khai báo tại: [pagination.dto.ts](file:///d:/workspace/project/solavie/backend/src/core/dto/pagination.dto.ts). Lập trình viên không được tự viết logic phân trang thủ công ở controller/service.

```typescript
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100) // Khống chế giới hạn trên phòng vệ DoS/OOM
  limit?: number = 20;

  get skip(): number {
    return ((this.page || 1) - 1) * (this.limit || 20);
  }

  get take(): number {
    return this.limit || 20;
  }
}
```

### 1.2. Kế Thừa Trong Module Nghiệp Vụ
Khi viết API danh sách cho module mới (ví dụ CRM Customers):
```typescript
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from 'src/core/dto/pagination.dto';

export class CustomerListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
}
```
Trong Controller, sử dụng decorator `@Query()`:
```typescript
@Get()
async findAll(@Query() query: CustomerListQueryDto) {
  return this.customersService.findAll(query);
}
```

---

## 2. Đồng Bộ & Chuẩn Hóa Response (Đầu Ra)

Hệ thống sử dụng [TransformInterceptor](file:///d:/workspace/project/solavie/backend/src/core/interceptors/transform.interceptor.ts) toàn cục để tự động bọc mọi thành công trả về dưới dạng JSON Success Envelope.

### 2.1. Cấu Trúc JSON Success Envelope
```json
{
  "statusCode": 200,
  "timestamp": "2026-06-20T00:00:00.000Z",
  "traceId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "errorCode": null,
  "message": "Request successful",
  "data": { ... }
}
```

### 2.2. Phân Trang Đầu Ra Với `PaginatedResponseDto<T>`
Trong Service, khi trả về kết quả phân trang, bắt buộc phải trả về lớp bọc để Interceptor tự động làm phẳng metadata:
```typescript
import { PaginatedResponseDto } from 'src/core/dto/pagination.dto';

async findAll(query: CustomerListQueryDto): Promise<PaginatedResponseDto<CustomerEntity>> {
  const [data, total] = await this.customerRepository.findAndCount({
    skip: query.skip,
    take: query.take,
  });
  return new PaginatedResponseDto(data, total, query.page, query.limit);
}
```
*Kết quả JSON trả về cho Client:*
```json
{
  "statusCode": 200,
  "timestamp": "2026-06-20T00:00:00.000Z",
  "traceId": "t_req_uuid_trace",
  "errorCode": null,
  "message": "Request successful",
  "data": [ ... ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

### 2.3. Cơ Chế Phòng Ngự & Bỏ Qua (Bypass Interceptor)
Interceptor tự động bỏ qua (không bọc) đối với:
1.  Các phản hồi không phải kiểu `application/json` (PDF, Excel, hình ảnh).
2.  Các file tải xuống đính kèm (`Content-Disposition: attachment`).
3.  Các HTTP Status 3xx (Redirect).
4.  Các API gọi webhook ngoài sử dụng `@SkipTransform()` ở cấp độ Controller/Handler.

---

## 3. Kiến Trúc Bản Địa Hóa Lai (Hybrid i18n)

Bản địa hóa trong hệ thống Solavie được phân bổ thông minh giữa Frontend và Backend.

### 3.1. Phân Vai Xử Lý i18n
1.  **Frontend (FE):** Dịch toàn bộ giao diện tĩnh, nhãn, nút bấm, menu và thực thi định dạng ngày tháng/tiền tệ tại client. FE ánh xạ mã `errorCode` (ví dụ: `auth.password_too_weak`) sang từ điển đa ngôn ngữ ở FE.
2.  **Backend (BE):** Trả về `errorCode` dạng chuỗi định danh máy (machine-readable) ổn định kèm message mặc định tiếng Anh. BE chỉ thực hiện dịch trực tiếp đối với các dịch vụ chạy ngầm không có UI tức thời (gửi Email, thông báo đẩy, sinh tệp PDF hóa đơn).

### 3.2. Cấu Hình Cài Đặt Cá Nhân `UserSettingEntity`
Cấu hình cá nhân của người dùng được tách riêng ra bảng [UserSettingEntity](file:///d:/workspace/project/solavie/backend/src/modules/iam/entities/user-setting.entity.ts) với quan hệ OneToOne. Bảng này quản lý:
*   `preferredLang` (Ngôn ngữ ưu tiên: `vi`, `en`)
*   `timezone` (Múi giờ: `Asia/Ho_Chi_Minh`, v.v.)
*   `theme` (Giao diện hiển thị: `light`, `dark`)

**Quy tắc nghiệp vụ:**
*   Khi tạo User mới, hệ thống bắt buộc khởi tạo bản ghi default settings tương ứng trong transaction của `createUser()`.
*   Cung cấp API cho phép User cập nhật cấu hình thông qua `UpdateProfileDto` tại endpoint PATCH `/api/v1/iam/users/me/profile`.

---

## 4. Kiểm Soát & Chuẩn Hóa Lỗi (Exception Handling)

Hệ thống sử dụng [GlobalExceptionFilter](file:///d:/workspace/project/solavie/backend/src/core/filters/global-exception.filter.ts) toàn cục để bắt mọi ngoại lệ và cấu trúc lại JSON Error Response đồng dạng với Success Response.

### 4.1. Cấu Trúc JSON Error Response
```json
{
  "statusCode": 400,
  "timestamp": "2026-06-20T00:00:00.000Z",
  "path": "/api/v1/iam/users",
  "errorCode": "validation.failed",
  "message": [
    "Password must contain at least one uppercase letter..."
  ],
  "traceId": "t_req_uuid_trace"
}
```

### 4.2. Nguyên Tắc Trả Về Lỗi Trong Code:
*   Luôn ném ra các `HttpException` chuẩn của NestJS kèm mã định danh lỗi nghiệp vụ (`errorCode`/`code`) khi cần thiết:
    ```typescript
    throw new BadRequestException({
      errorCode: 'auth.password_same_as_old',
      message: 'New password must be different from the old password',
    });
    ```
*   `GlobalExceptionFilter` tự động trích xuất `errorCode` này hoặc tự động sinh ra mã lỗi mặc định dựa trên loại Exception nếu lập trình viên không cung cấp.

---

## 5. Cơ Chế Chống Trùng Lặp Phía Tiêu Thụ (Inbox Pattern)

Hệ thống sử dụng cơ chế **Inbox Pattern** để đảm bảo tính Idempotency ở phía nhận tin (Consumer) khi BullMQ/Broker giao lặp sự kiện.

### 5.1. Hạ tầng hỗ trợ: `InboxService`
Sử dụng [InboxService](file:///d:/workspace/project/solavie/backend/src/core/outbox/inbox.service.ts) để tự động hóa việc kiểm soát giao dịch chống trùng lặp. Bảng `core_processed_events` lưu khóa phức hợp `{ eventId, consumerName }`.

### 5.2. Cách triển khai trong Consumer nghiệp vụ:
Khi tạo một Consumer lắng nghe sự kiện, lập trình viên bắt buộc phải bọc logic xử lý nghiệp vụ thông qua `inboxService.executeIdempotent`:

```typescript
@OnEvent(IamEventTypes.AUTH_USER_CREATED)
async handleUserCreated(payload: UserCreatedEvent) {
  const consumerName = 'NotificationConsumer.handleUserCreated';
  
  await this.inboxService.executeIdempotent(
    payload.userId, // Dùng ID duy nhất của Event/Tài nguyên làm khóa
    consumerName,
    async () => {
      // Logic nghiệp vụ thực tế (Ví dụ: gửi email)
      await this.emailService.sendActivationEmail(payload);
    }
  );
}
```

---

## 6. Quy Chuẩn Kết Nối Ngoại Biên (HTTP/Mail Timeout)

Để tránh hiện tượng Worker xử lý sự kiện bị nghẽn mạng vô hạn dẫn đến tình trạng cướp quyền (Race Condition) giữa các replica nodes:

1.  **Cấu hình Timeout bắt buộc:** Mọi Axios, NestJS HttpModule client, hoặc Mail Client khi gọi dịch vụ bên ngoài (SMTP Mail, Google/Facebook Auth API, CRM API) **phải cấu hình tham số Timeout rõ ràng** (khuyến nghị tối đa **15 giây**).
2.  **Nguyên lý an toàn:** Thời gian Timeout ngoại biên tuyệt đối phải nhỏ hơn rất nhiều so với ngưỡng khôi phục sự kiện `PROCESSING` của Outbox Worker (hiện tại cấu hình là **5 phút**).

---

## 7. Quy Chuẩn RESTful Cho API Cấu Hình Luồng & Từ Khóa (Chatbot Module)

Để quản trị hệ thống kịch bản tự động hóa tự do, các endpoint của Chatbot Module phải tuân thủ nghiêm ngặt chuẩn RESTful, sử dụng Header `Idempotency-Key` cho các lệnh ghi/sửa đổi.

### 7.1. Danh Sách Endpoints Quản Trị Cốt Lõi

| HTTP Method | URI Path | Vai Trò | Header Bắt Buộc |
|---|---|---|---|
| `GET` | `/api/v1/chatbot/flows` | Lấy danh sách kịch bản (có phân trang) | — |
| `POST` | `/api/v1/chatbot/flows` | Tạo mới kịch bản (bao gồm tạo nháp các Nodes) | `Idempotency-Key` |
| `GET` | `/api/v1/chatbot/flows/:id` | Xem chi tiết cấu trúc kịch bản và các Nodes của nó | — |
| `PUT` | `/api/v1/chatbot/flows/:id` | Cập nhật cấu trúc toàn bộ kịch bản và danh sách Nodes | `Idempotency-Key` |
| `DELETE` | `/api/v1/chatbot/flows/:id` | Xóa kịch bản (Cascade delete các Nodes đi kèm) | — |
| `GET` | `/api/v1/chatbot/keywords` | Lấy danh sách từ khóa cấu hình | — |
| `POST` | `/api/v1/chatbot/keywords` | Đăng ký từ khóa kích hoạt kịch bản mới | `Idempotency-Key` |
| `POST` | `/api/v1/chatbot/broadcast-campaigns` | Tạo chiến dịch gửi tin hàng loạt | `Idempotency-Key` |
| `POST` | `/api/v1/chatbot/broadcast-campaigns/:id/execute` | Kích hoạt chạy chiến dịch qua BullMQ | `Idempotency-Key` |

### 7.2. Định Dạng JSON Payload Cấu Hình Flow Phức Tạp

Khi Admin tạo mới hoặc cập nhật một Flow (`POST /api/v1/chatbot/flows`), payload gửi lên chứa cả cấu trúc của kịch bản và các nodes con đi kèm để ghi nhận trong cùng một DB Transaction:

```json
{
  "name": "Kịch bản khảo sát mái Solar",
  "description": "Thu thập thông tin diện tích mái và hóa đơn điện",
  "is_active": true,
  "nodes": [
    {
      "id": "node-root-111",
      "type": "MESSAGE",
      "content": {
        "text": "Chào anh/chị, em có thể xin thông tin hóa đơn tiền điện hàng tháng của mình không ạ?",
        "buttons": [
          { "label": "Dưới 1 triệu", "next_node_id": "node-under-1m" },
          { "label": "Từ 1-3 triệu", "next_node_id": "node-calc-roi" },
          { "label": "Trên 3 triệu", "next_node_id": "node-calc-roi" }
        ]
      }
    },
    {
      "id": "node-under-1m",
      "type": "MESSAGE",
      "content": {
        "text": "Dạ, với hóa đơn dưới 1 triệu, việc lắp đặt solar có thể chưa tối ưu hoàn vốn ngay. Anh/chị có muốn đặt lịch hẹn chuyên gia gọi tư vấn sâu hơn không?",
        "buttons": [
          { "label": "Đặt lịch hẹn", "next_node_id": "node-action-booking" },
          { "label": "Không, cảm ơn", "next_node_id": "node-goodbye" }
        ]
      }
    },
    {
      "id": "node-action-booking",
      "type": "ACTION",
      "content": {
        "action_type": "TRIGGER_BOOKING_SLOTS",
        "event_type_slug": "tu-van-online"
      },
      "next_node_id": "node-goodbye"
    },
    {
      "id": "node-calc-roi",
      "type": "ACTION",
      "content": {
        "action_type": "CALCULATE_ROI_AND_SAVE",
        "next_node_id": "node-goodbye"
      }
    },
    {
      "id": "node-goodbye",
      "type": "MESSAGE",
      "content": {
        "text": "Cảm ơn anh/chị đã quan tâm đến giải pháp Solavie Solar!"
      }
    }
  ]
}
```

### 7.3. Thuật Toán Kiểm Tra Đồ Thị (Graph Validation Engine)

Trước khi thực hiện `INSERT` hoặc `UPDATE` danh sách nodes dưới Database, `FlowsService` bắt buộc phải chạy bộ xác thực đồ thị (`GraphValidator`) để phòng ngừa lỗi kịch bản:

1.  **Chặn Vòng Lặp Vô Hạn (Cycle Detection):**
    -   Sử dụng thuật toán **Duyệt đồ thị theo chiều sâu (DFS)** để tìm chu trình.
    -   Nếu phát hiện đường đi từ Node A quay trở lại chính nó (không qua các mốc trì hoãn thời gian hoặc nút click), ném lỗi `400 Bad Request` với mã `FLOW_LOOP_DETECTED`.
2.  **Chặn Node Mồ Côi (Orphan Nodes Detection):**
    -   Sử dụng thuật toán **Duyệt đồ thị theo chiều rộng (BFS)** bắt đầu từ Node đầu tiên (Node Root).
    -   Tất cả các nodes khai báo trong mảng `nodes` bắt buộc phải có thể truy cập được từ Root Node. Nếu tồn tại node không thể đi tới (mồ côi) -> Ném lỗi `400 Bad Request`.
3.  **Xác Thực Node Tiếp Theo (Next Node Pointer Integrity):**
    -   Kiểm tra toàn bộ các giá trị `next_node_id` hoặc các con trỏ liên kết trong mảng `buttons` của từng node. Các ID đích này bắt buộc phải tồn tại trong danh sách nodes gửi lên.

---

## 8. BẢN ĐỒ REST API HỆ THỐNG (API CATALOG)

Dưới đây là đặc tả chi tiết toàn bộ danh mục các API Endpoints trên các Module nghiệp vụ của Solavie Platform.

### 8.1. Module Gateway & Đa Kênh (Facebook / Zalo Connections)

#### 1. Facebook Webhook Receiver
*   **Method & Path:** `POST /api/v1/gateway/webhooks/facebook`
*   **Auth Guard:** `Public` (Xác thực chữ ký `X-Hub-Signature-256` qua `FacebookSignatureGuard` sử dụng `FACEBOOK_APP_SECRET`).
*   **Mô tả:** Tiếp nhận webhook sự kiện nhắn tin, bình luận và nút tương tác từ Facebook Messenger.
*   **Payload:** Dạng Webhook Event JSON thô của Facebook.

#### 2. Zalo Webhook Receiver
*   **Method & Path:** `POST /api/v1/gateway/webhooks/zalo`
*   **Auth Guard:** `Public` (Xác thực chữ ký `X-Zephyr-Signature` hoặc token bắt tay Zalo).
*   **Mô tả:** Tiếp nhận webhook sự kiện nhắn tin, chia sẻ SĐT từ khách hàng trên Zalo OA.
*   **Payload:** Dạng Webhook Event JSON thô của Zalo.

#### 3. AI Providers Registry (Admin)
*   **Method & Path:** `GET /api/v1/gateway/providers` (Danh sách), `POST /api/v1/gateway/providers` (Tạo mới)
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('gateway.providers.manage')`
*   **Header yêu cầu:** `Idempotency-Key` (chỉ áp dụng cho `POST`).
*   **Request Body (POST):**
    ```typescript
    export class CreateProviderDto {
      @IsString() @IsNotEmpty() name: string; // VD: "DeepSeek", "Groq"
      @IsUrl() @IsNotEmpty() baseUrl: string;
      @IsString() @IsNotEmpty() apiKey: string; // Tự động mã hóa AES-256-GCM ở DB
    }
    ```

#### 4. Channel Configurations (Admin)
*   **Method & Path:** `GET /api/v1/gateway/channel-configurations` (Danh sách), `POST /api/v1/gateway/channel-configurations` (Tạo mới)
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('gateway.channels.manage')`

---

### 8.2. Module Chatbot (Tự Động Hóa, Kịch Bản & Broadcasting)

#### 1. Quản lý Từ Khóa (Keywords Manager)
*   **Method & Path:** `GET /api/v1/chatbot/keywords` (Danh sách), `POST /api/v1/chatbot/keywords` (Đăng ký từ khóa)
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('chatbot.keywords.write')`
*   **Request Body (POST):**
    ```typescript
    export class CreateKeywordDto {
      @IsString() @IsNotEmpty() keyword: string;
      @IsEnum(['EXACT', 'CONTAINS', 'STARTS_WITH']) matchType: string;
      @IsUUID() flowId: string; // Kích hoạt kịch bản khi khớp từ khóa
    }
    ```

#### 2. Quản lý Chuỗi Chăm Sóc (Sequences)
*   **Method & Path:** `GET /api/v1/chatbot/sequences`, `POST /api/v1/chatbot/sequences`
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('chatbot.sequences.write')`
*   **Request Body (POST):**
    ```typescript
    export class CreateSequenceDto {
      @IsString() @IsNotEmpty() name: string;
      @IsArray() @ValidateNested({ each: true }) steps: CreateSequenceStepDto[];
    }
    export class CreateSequenceStepDto {
      @IsInt() @Min(0) delaySeconds: number; // Thời gian trì hoãn
      @IsUUID() flowId: string;              // Kịch bản gửi bám đuổi
      @IsInt() @Min(1) sortOrder: number;
    }
    ```

#### 3. Quản lý Công Cụ Tăng Trưởng (Growth Tools - Ref Link/QR)
*   **Method & Path:** `GET /api/v1/chatbot/growth-tools`, `POST /api/v1/chatbot/growth-tools`
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('chatbot.flows.write')`
*   **Request Body (POST):**
    ```typescript
    export class CreateGrowthToolDto {
      @IsString() @IsNotEmpty() name: string;
      @IsString() @IsNotEmpty() type: 'REF_LINK' | 'QR_CODE';
      @IsUUID() flowId: string;
      @IsString() @IsNotEmpty() refParameter: string; // Mã tham số ref chiến dịch
    }
    ```

#### 4. Gửi Tin Hàng Loạt (Broadcasting)
*   **Method & Path:** `POST /api/v1/chatbot/broadcast-campaigns` (Tạo), `POST /api/v1/chatbot/broadcast-campaigns/:id/execute` (Kích hoạt gửi)
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('chatbot.broadcasts.write')`
*   **Request Body (Tạo):**
    ```typescript
    export class CreateBroadcastCampaignDto {
      @IsString() @IsNotEmpty() name: string;
      @IsEnum(['FACEBOOK', 'ZALO']) channel: string;
      @IsObject() targetingRules: Record<string, any>; // Quy tắc lọc tệp đối tượng CRM
      @IsObject() messagePayload: Record<string, any>; // Cấu trúc tin nhắn gửi đi
      @IsOptional() @IsDateString() scheduledAt?: string; // Hẹn giờ gửi
    }
    ```

---

### 8.3. Module CRM & ROI Calculator

#### 1. Lấy danh sách Khách hàng (Leads Feed)
*   **Method & Path:** `GET /api/v1/crm/customers`
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('crm.customer.read')`
*   **Query Helper:** Áp dụng `TypeOrmQueryHelper` để lọc trạng thái, gán người và phân trang.

#### 2. Gộp Hồ Sơ Khách Hàng Thủ Công (Manual Merge Profiles)
*   **Method & Path:** `POST /api/v1/crm/customers/:id/merge`
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('crm.customer.write')`
*   **Request Body:**
    ```typescript
    export class MergeCustomersRequestDto {
      @IsUUID() targetCustomerId: string; // ID hồ sơ bị gộp (sẽ bị xóa/đóng)
    }
    ```
*   **Lỗi nghiệp vụ:**
    *   `404 NOT_FOUND` (nếu không tìm thấy khách hàng).
    *   `409 CONFLICT` (nếu tài nguyên đang bị khóa phân tán bởi `lock:merge:phone:${phone}`).

#### 3. Bộ Tính Toán ROI Mặt Trời (ROI Calculator)
*   **Method & Path:** `POST /api/v1/crm/roi-calculate`
*   **Auth Guard:** `Public` (Mở rộng cho chatbot và web khách hàng tự tính).
*   **Request Body:**
    ```typescript
    export class CalculateRoiDto {
      @IsString() @IsNotEmpty() province: string; // Tỉnh thành (để tra cứu số giờ nắng)
      @IsInt() @Min(0) monthlyElectricityCost: number; // Tiền điện hàng tháng (VNĐ)
      @IsInt() @Min(0) usableRoofArea: number; // Diện tích mái (m2)
    }
    ```

---

### 8.4. Module Agent Inbox (Livechat & Comments)

#### 1. Unified Inbox Feed
*   **Method & Path:** `GET /api/v1/inbox/conversations`
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('inbox.conversation.read')`
*   **Query Helper:** Sử dụng `TypeOrmQueryHelper` phân trang, lọc trạng thái (`AUTOMATIC` / `MANUAL`), assignee, và tìm kiếm.

#### 2. Dòng Thời Gian Hội Thoại (Timeline)
*   **Method & Path:** `GET /api/v1/inbox/conversations/:id/timeline`
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('inbox.conversation.read')`
*   **Mô tả:** Trả về danh sách gộp cả tin nhắn `chat_messages` và thảo luận nội bộ `inbox_internal_comments` sắp xếp thời gian tăng dần.

#### 3. Tiếp Quản Cuộc Trò Chuyện (Claim Chat)
*   **Method & Path:** `POST /api/v1/inbox/conversations/:id/claim`
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('inbox.conversation.write')` (Sử dụng `ConversationHydrator` kiểm tra trạng thái ABAC: chỉ cho claim nếu conversation.state = MANUAL và assignee_id rỗng).

#### 4. Nhân Viên Gửi Tin Nhắn (Send Agent Message)
*   **Method & Path:** `POST /api/v1/inbox/conversations/:id/messages`
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('inbox.conversation.write')` (Kiểm duyệt ABAC: cấm gửi nếu bot_state = AUTOMATIC. Kiểm duyệt chính sách 24h: ném lỗi `OUTSIDE_24H_WINDOW` nếu ngoài 24h mà không có tag Message Tag đính kèm).
*   **Request Body:**
    ```typescript
    export class CreateAgentMessageDto {
      @IsString() @IsNotEmpty() content: string;
      @IsOptional() @IsEnum(['CONFIRMED_EVENT_UPDATE', 'HUMAN_AGENT']) tag?: string;
    }
    ```

#### 5. Thảo Luận Nội Bộ (Internal Comments)
*   **Method & Path:** `POST /api/v1/inbox/conversations/:id/comments`
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('inbox.conversation.write')`
*   **Request Body:**
    ```typescript
    export class CreateInternalCommentDto {
      @IsString() @IsNotEmpty() content: string; // Nội dung hỗ trợ tag @tên_sales
    }
    ```

---

### 8.5. Module Booking (Đặt Lịch Hẹn)

#### 1. Truy Vấn Slot Giờ Trống (Available Slots)
*   **Method & Path:** `GET /api/v1/booking/slots`
*   **Auth Guard:** `Public`
*   **Query Params:** `eventTypeId`, `salesId` (tùy chọn), `startDate`, `endDate`.
*   **Mô tả:** Trả về danh sách slot rảnh rỗi của Sales phục vụ giao diện đặt lịch hoặc AI Chatbot gợi ý.

#### 2. Khách Hàng Đăng Ký Đặt Lịch (Book Appointment)
*   **Method & Path:** `POST /api/v1/booking/appointments`
*   **Auth Guard:** `Public`
*   **Header yêu cầu:** `Idempotency-Key` (tránh click đúp trùng lặp).
*   **Request Body:**
    ```typescript
    export class CreateAppointmentDto {
      @IsUUID() eventTypeId: string;
      @IsOptional() @IsUUID() salesId?: string; // Tự động Round-Robin nếu trống
      @IsDateString() startTime: string;
      @IsString() @IsNotEmpty() customerName: string;
      @IsEmail() customerEmail: string;
      @IsString() @IsNotEmpty()
      @Matches(/^(0|84)(3|5|7|8|9)[0-9]{8}$/, {
        message: 'INVALID_PHONE_NUMBER: Số điện thoại di động không đúng định dạng Việt Nam.'
      })
      customerPhone: string;
      @IsOptional() @IsString() notes?: string;
    }
    ```
*   **Lỗi nghiệp vụ:**
    *   `400 BAD_REQUEST` với mã `INVALID_PHONE_NUMBER` (nếu SĐT sai định dạng).
    *   `409 CONFLICT` với mã `SLOT_NOT_AVAILABLE` (nếu slot đã bị Sales khác chiếm hoặc trùng).

#### 3. Hủy hoặc Đổi Lịch Hẹn (Cancel / Reschedule)
*   **Hủy cuộc hẹn:** `PUT /api/v1/booking/appointments/:id/cancel`
    *   Body: `{ reason: string }`
*   **Đổi lịch hẹn:** `PUT /api/v1/booking/appointments/:id/reschedule`
    *   Body: `{ newStartTime: string, reason?: string }`
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('booking.appointment.write')` (Sử dụng `BookingHydrator` để kiểm tra quyền sở hữu ABAC: chỉ cho phép chính Host Sales sở hữu lịch hẹn thực hiện).

---

### 8.6. Module Notification (Nhật Ký & Cấu Hình)

#### 1. Nhật Ký Gửi Thông Báo (Logs)
*   **Method & Path:** `GET /api/v1/notification/logs`
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('notification.log.read')`
*   **Query Helper:** Sử dụng `TypeOrmQueryHelper` phân trang và lọc theo trạng thái (`SENT`, `FAILED`, `SKIPPED`), channel.

#### 2. Cấu Hình Tùy Chọn Nhận Thông Báo (Preferences)
*   **Lấy tùy chọn:** `GET /api/v1/notification/preferences/:userId`
*   **Cập nhật tùy chọn:** `POST /api/v1/notification/preferences/:userId`
*   **Auth Guard:** `JwtAuthGuard`, `RequirePermissions('notification.preference.write')` (Sử dụng `PreferenceHydrator` kiểm tra ABAC: Sales chỉ được cấu hình preferences của chính mình).
*   **Request Body (POST):**
    ```typescript
    export class UpdatePreferencesDto {
      @IsBoolean() emailEnabled: boolean;
      @IsBoolean() inAppEnabled: boolean;
      @IsOptional() @IsString() quietHoursStart?: string; // VD: "22:00"
      @IsOptional() @IsString() quietHoursEnd?: string;   // VD: "07:00"
    }
    ```



