# Thiết Kế Chi Tiết Module Đặt Lịch Hẹn (Design)

## 1. Thiết Kế Cơ Sở Dữ Liệu (Database Schema)

Các bảng thuộc module Đặt Lịch Hẹn sử dụng tiền tố `booking_`, liên kết mềm sang các module khác:

### 1.1. Bảng `booking_event_types` (Loại cuộc hẹn mẫu)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY, gen_random_uuid() | Định danh duy nhất |
| `title` | VARCHAR(255) | NOT NULL | Tên loại cuộc hẹn (VD: "Khảo sát thực địa") |
| `slug` | VARCHAR(100) | UNIQUE, NOT NULL | Slug link (VD: `khao-sat-30p`) |
| `duration` | INTEGER | NOT NULL | Thời lượng (Tính bằng phút, VD: 30) |
| `location_type` | VARCHAR(50) | NOT NULL | `GOOGLE_MEET`, `PHONE`, hoặc `ONSITE` |
| `description` | TEXT | | Nội dung mô tả sự chuẩn bị |
| `is_active` | BOOLEAN | Default TRUE | Cờ kích hoạt mẫu |
| `created_at` | TIMESTAMP | Default NOW() | Thời điểm tạo |

### 1.2. Bảng `booking_availabilities` (Lịch rảnh trong tuần của Sales)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY, gen_random_uuid() | Định danh duy nhất |
| `user_id` | UUID | NOT NULL (Soft link `iam_users.id`) | Sales sở hữu cấu hình lịch rảnh |
| `day_of_week` | INTEGER | NOT NULL | Ngày trong tuần: `0` (CN) -> `6` (T7) |
| `start_time` | TIME | NOT NULL | Giờ rảnh bắt đầu (VD: `'08:00:00'`) |
| `end_time` | TIME | NOT NULL | Giờ rảnh kết thúc (VD: `'17:00:00'`) |

### 1.3. Bảng `booking_appointments` (Các lịch hẹn thực tế)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY, gen_random_uuid() | Định danh cuộc hẹn |
| `event_type_id` | UUID | NOT NULL (Soft link `booking_event_types.id`) | Trỏ về loại cuộc hẹn mẫu |
| `host_id` | UUID | NOT NULL (Soft link `iam_users.id`) | Sales Rep tiếp đón cuộc hẹn |
| `customer_id` | UUID | NOT NULL (Soft link `crm_customers.id`) | Khách hàng đặt lịch |
| `customer_name` | VARCHAR(255) | NOT NULL | Họ tên khách hàng |
| `customer_email`| VARCHAR(255) | NOT NULL | Địa chỉ email của khách |
| `customer_phone`| VARCHAR(50) | NOT NULL | Số điện thoại của khách |
| `start_time` | TIMESTAMP | NOT NULL | Thời điểm bắt đầu cuộc hẹn |
| `end_time` | TIMESTAMP | NOT NULL | Thời điểm kết thúc cuộc hẹn |
| `status` | VARCHAR(50) | Default 'CONFIRMED' | `PENDING`, `CONFIRMED`, `CANCELLED`, `RESCHEDULED`, `COMPLETED`, `NO_SHOW` |
| `meeting_link` | VARCHAR(500) | | Link Google Meet họp trực tuyến |
| `notes` | TEXT | | Ghi chú khách hàng gửi kèm |
| `created_at` | TIMESTAMP | Default NOW() | Thời gian tạo |
| `updated_at` | TIMESTAMP | Default NOW() | Thời gian cập nhật gần nhất |

### 1.4. Bảng đệm sự kiện (Transactional Outbox)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Định danh event |
| `event_type`| VARCHAR(100) | NOT NULL | VD: `appointment.confirmed` |
| `payload` | JSONB | NOT NULL | Chứa `eventId` và data |
| `status` | VARCHAR(20) | Default 'PENDING' | `PENDING`, `PROCESSED`, `FAILED` |

---

## 2. Thiết Kế REST APIs (RESTful Endpoints)

### 2.1. Lấy danh sách khung giờ trống (Available Slots)
*   **Method & Route:** `GET /api/v1/booking/slots`
*   **Request Query Param (`GetAvailableSlotsQueryDto`):**
    ```typescript
    export class GetAvailableSlotsQueryDto {
      @IsUUID()
      eventTypeId: string;

      @IsOptional()
      @IsUUID()
      salesId?: string; // Nếu gửi lên thì lấy riêng lịch của Sales đó, nếu không thì phân phối Round-Robin

      @IsDateString()
      startDate: string; // Định dạng YYYY-MM-DD

      @IsDateString()
      endDate: string; // Định dạng YYYY-MM-DD
    }
    ```
*   **Response Payload:**
    ```json
    {
      "slots": [
        "2026-06-17T08:00:00.000Z",
        "2026-06-17T08:45:00.000Z",
        "2026-06-17T09:30:00.000Z"
      ]
    }
    ```

### 2.2. Khách hàng Tạo Lịch hẹn mới (Book Appointment)
*   **Method & Route:** `POST /api/v1/booking/appointments`
*   **Request Body DTO (`CreateAppointmentDto`):**
    ```typescript
    export class CreateAppointmentDto {
      @IsUUID()
      eventTypeId: string;

      @IsOptional()
      @IsUUID()
      salesId?: string; // Có thể chỉ định đích danh Sales hoặc bỏ trống để tự động gán Round-Robin

      @IsDateString()
      startTime: string; // ISO String

      @IsString()
      @IsNotEmpty()
      customerName: string;

      @IsEmail()
      customerEmail: string;

      @IsString()
      @IsNotEmpty()
      customerPhone: string;

      @IsOptional()
      @IsString()
      notes?: string;
    }
    ```

### 2.3. Hủy hoặc Đổi lịch (Cancel / Reschedule)
*   **Hủy cuộc hẹn:** `PUT /api/v1/booking/appointments/:id/cancel`
    *   Body: `{ reason: string }`
*   **Đổi lịch hẹn:** `PUT /api/v1/booking/appointments/:id/reschedule`
    *   Body: `{ newStartTime: string, reason?: string }`

### 2.4. Cấu hình Lịch rảnh của Sales (Cổng Portal)
*   **Lấy lịch rảnh:** `GET /api/v1/booking/availabilities` (Dựa trên JWT Token của Sales đang đăng nhập).
*   **Cập nhật lịch rảnh:** `POST /api/v1/booking/availabilities`
    *   Body DTO:
        ```typescript
        export class UpdateAvailabilityDto {
          @IsArray()
          @ValidateNested({ each: true })
          @Type(() => DailyAvailabilityDto)
          availabilities: DailyAvailabilityDto[];
        }

        export class DailyAvailabilityDto {
          @IsInt()
          @Min(0)
          @Max(6)
          dayOfWeek: number; // 0: CN -> 6: T7

          @IsString()
          startTime: string; // Format "HH:mm"

          @IsString()
          endTime: string; // Format "HH:mm"
        }
        ```
