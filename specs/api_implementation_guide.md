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

