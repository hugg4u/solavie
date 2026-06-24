# Thiết Kế Kỹ Thuật Module Notification (Design)

## 1. Tổng Quan Kiến Trúc

Module Notification được triển khai như một **NestJS Module nội bộ** (`NotificationModule`) trong Modular Monolith, tuân thủ nghiêm ngặt nguyên tắc Database Isolation — không import hay inject Service của module khác, chỉ giao tiếp qua `EventEmitter2`.

**Nguyên tắc thiết kế cốt lõi:**
- **Event Consumer Only**: `NotificationModule` không bao giờ phát event ra ngoài. Chỉ consume.
- **Provider Pattern**: Mỗi kênh giao tiếp (Email, Zalo, In-App) là một `INotificationProvider` độc lập.
- **Fan-out Architecture**: Một event có thể kích hoạt nhiều provider song song.
- **Queue-based Delivery**: Tier 2 và Tier 3 đều đi qua BullMQ để đảm bảo reliability.

---

## 2. Sơ Đồ Kiến Trúc (Architecture Diagram)

```mermaid
graph TD
    subgraph Event Producers
        CRM[CRM Module]
        BK[Booking Module]
        CB[Chatbot Module]
        IB[Inbox Module]
        IAM[IAM Module]
    end

    subgraph Internal Event Bus [EventEmitter2 / Redis Pub-Sub]
        EB{{Event Bus}}
    end

    CRM -->|lead.assigned / lead.score_hot| EB
    BK -->|appointment.confirmed / reminder_*| EB
    CB -->|chat.handover_requested| EB
    IB -->|inbox.agent_mentioned / inbox.new_message| EB
    IAM -->|permission.changed / auth.login_new_device| EB

    subgraph NotificationModule [Notification Module - Internal]
        EB -->|@OnEvent decorator| NS[NotificationService - Orchestrator]

        NS --> PREF[PreferenceService - Check opt-in]
        NS --> IDEM[IdempotencyService - Dedup check]
        NS --> TM[TemplateEngine - Handlebars Renderer]
        NS --> ROUTER[NotificationRouter - Fan-out]

        ROUTER -->|Tier 1: Direct Socket.io| INAPP[InAppProvider]
        ROUTER -->|Tier 2: BullMQ enqueue| EQ[(email-notification-queue)]
        ROUTER -->|Tier 2: BullMQ enqueue| ZQ[(zalo-notification-queue)]
        ROUTER -->|Tier 3: BullMQ delayed| SQ[(scheduled-notification-queue)]
    end

    subgraph Channel Workers
        EQ --> EW[EmailWorker]
        ZQ --> ZW[ZaloWorker]
        SQ --> SW[ScheduledWorker]
    end

    subgraph Delivery Providers
        EW --> SES[AWS SES / SMTP]
        ZW --> ZALO[Zalo ZNS API]
        SW --> SES
        SW --> ZALO
        INAPP -->|socket.emit| PORTAL[Sales Portal - Socket.io]
    end

    subgraph Persistence [Notification DB - Owned by this module]
        NS --> LOG[(notification_logs)]
        NS --> TMPL[(notification_templates)]
        PREF --> PREFS[(notification_preferences)]
    end

    %% Dead Letter Queue
    EW -->|After 3 retries fail| DLQ[(Dead-Letter Queue)]
    ZW -->|After 3 retries fail| DLQ
```

---

## 3. Cấu Trúc Thư Mục Module

```
src/
└── notification/
    ├── notification.module.ts          # NestJS Module declaration
    ├── notification.service.ts         # Orchestrator - @OnEvent handlers
    │
    ├── providers/
    │   ├── notification-provider.interface.ts   # INotificationProvider
    │   ├── email.provider.ts                    # EmailProvider (AWS SES)
    │   ├── zalo.provider.ts                     # ZaloProvider (ZNS API)
    │   └── in-app.provider.ts                   # InAppProvider (Socket.io)
    │
    ├── services/
    │   ├── notification-router.service.ts       # Fan-out + channel decision
    │   ├── template-engine.service.ts           # Handlebars renderer
    │   ├── preference.service.ts               # User preference lookup
    │   └── idempotency.service.ts              # Duplicate check
    │
    ├── queues/
    │   ├── email.queue.ts                      # BullMQ Queue definition
    │   ├── zalo.queue.ts
    │   └── scheduled.queue.ts
    │
    ├── workers/
    │   ├── email.worker.ts                     # BullMQ Processor
    │   ├── zalo.worker.ts
    │   └── scheduled.worker.ts
    │
    ├── entities/
    │   ├── notification-log.entity.ts
    │   ├── notification-template.entity.ts
    │   └── notification-preference.entity.ts
    │
    ├── dto/
    │   ├── notification-payload.dto.ts
    │   └── notification-job.dto.ts
    │
    └── events/
        └── notification-event.types.ts         # Event payload type definitions
```

---

## 4. Database Schema

### 4.1. Bảng `notification_preferences`
```sql
CREATE TABLE notification_preferences (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL UNIQUE,  -- Soft link to iam_users
  email_enabled       BOOLEAN     NOT NULL DEFAULT true,
  zalo_enabled        BOOLEAN     NOT NULL DEFAULT false,  -- Không áp dụng cho internal staff
  in_app_enabled      BOOLEAN     NOT NULL DEFAULT true,
  -- Quiet Hours: hệ thống không gửi Email trong khoảng thời gian này
  quiet_hours_start   TIME,       -- VD: 22:00
  quiet_hours_end     TIME,       -- VD: 07:00
  -- Event-level overrides (JSON): {"lead.assigned": {"email": false}}
  event_overrides     JSONB       NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_pref_user_id ON notification_preferences(user_id);
```

### 4.2. Bảng `notification_templates`
```sql
CREATE TABLE notification_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    VARCHAR(100) NOT NULL,    -- VD: 'appointment.confirmed'
  channel       VARCHAR(50)  NOT NULL,    -- 'email' | 'zalo' | 'in_app'
  language      VARCHAR(10)  NOT NULL DEFAULT 'vi',  -- 'vi' | 'en'
  subject       TEXT,                     -- Chỉ dành cho kênh 'email'
  body_template TEXT        NOT NULL,     -- Handlebars template string
  zalo_template_id VARCHAR(100),          -- Zalo ZNS Template ID đã phê duyệt
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(event_type, channel, language)
);
```

### 4.3. Bảng `notification_logs`
```sql
CREATE TABLE notification_logs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key   VARCHAR(255) NOT NULL UNIQUE,   -- SHA256 hash
  event_type        VARCHAR(100) NOT NULL,
  event_entity_id   UUID,                           -- ID của entity gốc (appointment_id, lead_id...)
  -- Recipient info (có thể là Staff hoặc Customer)
  recipient_type    VARCHAR(20)  NOT NULL,           -- 'staff' | 'customer'
  recipient_id      UUID,                           -- user_id nếu là staff
  recipient_contact VARCHAR(255),                   -- email hoặc zalo_user_id
  channel           VARCHAR(50)  NOT NULL,           -- 'email' | 'zalo' | 'in_app'
  -- Delivery status
  status            VARCHAR(20)  NOT NULL DEFAULT 'QUEUED',
                    -- QUEUED | PROCESSING | SENT | FAILED | SKIPPED
  skip_reason       VARCHAR(100),                   -- 'IDEMPOTENT' | 'PREFERENCE_OPT_OUT' | 'QUIET_HOURS' | 'NO_CONTACT'
  error_message     TEXT,
  retry_count       SMALLINT    NOT NULL DEFAULT 0,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_log_event_type ON notification_logs(event_type);
CREATE INDEX idx_notif_log_recipient ON notification_logs(recipient_id);
CREATE INDEX idx_notif_log_status ON notification_logs(status);
CREATE INDEX idx_notif_log_created ON notification_logs(created_at DESC);
```

---

## 5. Interface & DTO Thiết Kế

### 5.1. INotificationProvider Interface
```typescript
// notification/providers/notification-provider.interface.ts

export interface NotificationPayload {
  to: string;           // email address | zalo_user_id | socket_user_id
  subject?: string;     // Chỉ dùng cho email
  body: string;         // HTML (email) | plain text (Zalo ZNS) | JSON (in_app)
  templateId?: string;  // Zalo ZNS Template ID
  templateData?: Record<string, string>;  // ZNS template variables
  metadata?: Record<string, unknown>;     // Extra context for logging
}

export interface DeliveryResult {
  success: boolean;
  messageId?: string;   // External provider message ID
  error?: string;
}

export interface INotificationProvider {
  readonly channel: 'email' | 'zalo' | 'in_app';
  send(payload: NotificationPayload): Promise<DeliveryResult>;
}
```

### 5.2. Notification Job DTO
```typescript
// notification/dto/notification-job.dto.ts

export class NotificationJobDto {
  eventType: string;
  entityId?: string;
  recipientType: 'staff' | 'customer';
  recipientId?: string;         // iam_users.id
  recipientContact: string;     // email hoặc zalo_user_id
  channel: 'email' | 'zalo';
  templateContext: Record<string, unknown>;  // Biến động cho Handlebars
  idempotencyKey: string;
  priority?: number;            // BullMQ priority (1 = cao nhất)
}
```

### 5.3. Notification Event Payload Types
```typescript
// notification/events/notification-event.types.ts

export interface AppointmentEventPayload {
  appointmentId: string;
  eventType: string;      // 'Khảo sát thực địa' | 'Tư vấn báo giá'
  startTime: Date;
  endTime: Date;
  location: string;
  meetLink?: string;      // Google Meet URL (nếu có)
  salesName: string;
  salesEmail: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerZaloId?: string;
}

export interface LeadEventPayload {
  leadId: string;
  leadName: string;
  leadPhone: string;
  assigneeId: string;
  assigneeEmail: string;
  stageName?: string;
  leadScore?: number;
  leadTemperature?: 'COLD' | 'WARM' | 'HOT';
}

export interface HandoverEventPayload {
  conversationId: string;
  customerName: string;
  customerChannel: string;  // 'facebook' | 'zalo' | 'web'
  assigneeId: string;       // Sales Rep nhận
  lastMessage: string;
}
```

---

## 6. Luồng Xử Lý Chi Tiết

### 6.1. Luồng Tier 1 — Real-time In-App (CRITICAL)
```
[Event: chat.handover_requested]
    ↓
NotificationService.handleHandoverRequest()
    ↓
InAppProvider.send({ to: assigneeId, body: JSON notification data })
    ↓
Socket.io: socket.to(assigneeId).emit('notification:new', payload)
    ↓
notification_logs.insert(status='SENT')
```
**Tổng độ trễ mục tiêu: < 500ms**

### 6.2. Luồng Tier 2 — Transactional (Email + Zalo)
```
[Event: appointment.confirmed]
    ↓
NotificationService.handleAppointmentConfirmed()
    ↓
IdempotencyService.check(key) → Nếu đã SENT → Skip (log SKIPPED)
    ↓ (chưa có)
PreferenceService.getPreferences(recipientId) → Kiểm tra opt-in
    ↓
TemplateEngine.render(template, context) → Rendered HTML / text
    ↓
NotificationRouter.fanOut([
  EmailJob(salesEmail),   // Gửi cho Sales
  EmailJob(customerEmail), // Gửi cho Khách
  ZaloJob(customerZaloId)  // Gửi cho Khách qua ZNS
])
    ↓ (BullMQ enqueue)
EmailWorker → AWS SES → notification_logs(status='SENT')
ZaloWorker  → Zalo ZNS API → notification_logs(status='SENT')
```

### 6.3. Luồng Tier 3 — Scheduled Reminders (BullMQ Delayed)
```
[Event: appointment.confirmed] (sau khi Tier 2 xử lý)
    ↓
NotificationService tính delay:
  - reminder_24h: delay = (appointmentTime - 24h) - NOW()
  - reminder_1h:  delay = (appointmentTime - 1h) - NOW()
    ↓
BullMQ.add('scheduled-notification-queue', jobData, { delay: delayMs })
    ↓
[Sau khi delay trôi qua...]
ScheduledWorker xử lý → Fan-out Email + Zalo
    ↓
notification_logs(status='SENT')
```

**Hủy Reminder khi cuộc hẹn bị hủy:**
```
[Event: appointment.cancelled]
    ↓
NotificationService tìm jobId từ notification_logs WHERE entity_id = appointmentId AND status = 'QUEUED'
    ↓
BullMQ.remove(jobId_24h)
BullMQ.remove(jobId_1h)
    ↓
notification_logs UPDATE status='SKIPPED', skip_reason='APPOINTMENT_CANCELLED'
```

---

## 7. Zalo ZNS Integration & Fallback AWS SES — Chi Tiết Kỹ Thuật

### 7.1. Yêu cầu tiên quyết
- Solavie cần đăng ký template ZNS với Zalo và nhận `template_id` cho từng loại thông báo.
- Templates cần đăng ký:
  1. **Xác nhận cuộc hẹn** (`appointment.confirmed`): Gồm tên khách, tên Sales, thời gian, địa điểm.
  2. **Nhắc nhở 24h** (`appointment.reminder_24h`): Nhắc cuộc hẹn ngày mai.
  3. **Nhắc nhở 1h** (`appointment.reminder_1h`): Nhắc kèm link Google Meet (nếu có).
  4. **Hủy cuộc hẹn** (`appointment.cancelled`): Thông báo hủy và hướng dẫn đặt lại.

### 7.2. ZaloProvider Logic & Phone Normalization
```typescript
// notification/providers/zalo.provider.ts

async send(payload: NotificationPayload): Promise<DeliveryResult> {
  // Kiểm tra số điện thoại tồn tại
  if (!payload.to) {
    return { success: false, error: 'NO_PHONE_NUMBER' };
  }

  // Chuẩn hóa số điện thoại về định dạng 84xxxxxxxxx (Zalo ZNS yêu cầu)
  const normalizedPhone = this.normalizePhoneNumber(payload.to);

  try {
    // Gọi ZNS API thực tế thông qua Zalo OA Client
    const response = await this.zaloClient.sendZNS({
      phone: normalizedPhone,
      template_id: payload.templateId,
      template_data: payload.templateData,
      tracking_id: payload.metadata?.idempotencyKey,
    });

    return {
      success: response.error === 0,
      messageId: response.data?.zns_msg_id,
      error: response.error !== 0 ? `Zalo ZNS API Error ${response.error}: ${response.message}` : undefined,
    };
  } catch (err) {
    return {
      success: false,
      error: `Network/API Connection Error: ${err.message}`,
    };
  }
}

private normalizePhoneNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '84' + cleaned.substring(1);
  }
  if (!cleaned.startsWith('84')) {
    cleaned = '84' + cleaned;
  }
  return cleaned;
}
```

### 7.3. Fallback Strategy (AWS SES Fallback)
Khi `ZaloWorker` xử lý một Job Zalo ZNS nhưng thất bại (do số điện thoại khách hàng không đăng ký Zalo, do token OA bị hết hạn, do lỗi kết nối, hoặc do hết hạn mức gửi), Job sẽ tự động chuyển sang gửi Email qua AWS SES:
```
ZaloWorker.process(job):
  1. Thử gửi Zalo ZNS: ZaloProvider.send(znsPayload)
  2. Nếu ZaloProvider.send() thành công -> update notification_logs set status='SENT', channel='zalo'
  3. Nếu ZaloProvider.send() thất bại (success = false):
     - Ghi nhận lỗi vào log của job.
     - Kiểm tra nếu khách hàng có email (trích xuất từ context):
       - Gọi EmailProvider.send(emailPayload) gửi qua AWS SES.
       - Cập nhật notification_logs: status='SENT', channel='email', error_message='ZNS Failed: [error_detail]. Fallbacked to SES Email.'
     - Nếu khách hàng không có email -> update notification_logs set status='FAILED', error_message='ZNS Failed: [error_detail]. No email found for fallback.'
```


---

## 8. Cấu Hình Redis Queue (Tách Biệt Instance)

Tất cả BullMQ queues của Notification Module sử dụng **Redis instance `noeviction`** (port 6380) — cùng instance với Booking reminders và Chatbot queues — để đảm bảo không mất job khi bộ nhớ đầy.

```typescript
// notification/queues/email.queue.ts
BullModule.registerQueue({
  name: 'email-notification-queue',
  connection: {
    host: process.env.REDIS_QUEUE_HOST,  // port 6380 - noeviction
    port: parseInt(process.env.REDIS_QUEUE_PORT),
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: false,  // Giữ lại để phân tích DLQ
  },
});
```

---

## 9. Đặc Tả API Quản Lý & Phân Quyền (REST APIs & ABAC)

### 9.1. Lấy danh sách Nhật ký gửi (Notification Logs - Admin/Manager)
*   **Method & Route:** `GET /api/v1/notification/logs`
*   **Permission:** `RequirePermissions('notification.log.read')`
*   **Quy chuẩn truy vấn:** Áp dụng `TypeOrmQueryHelper` xử lý phân trang, lọc và tìm kiếm.
*   *Search fields:* `log.recipientContact`, `log.eventType`.
*   *Filter fields:* `status`, `channel`, `recipientType`.
*   *Sort fields:* `created_at`.
*   *Format đầu ra:* `PaginatedResponseDto<NotificationLogEntity>`.

### 9.2. Quản lý Mẫu thông báo (Templates - Admin Only)
*   **Method & Route:** `GET /api/v1/notification/templates`
*   **Permission:** `RequirePermissions('notification.template.manage')`
*   **Quy chuẩn truy vấn:** Áp dụng `TypeOrmQueryHelper` xử lý phân trang, lọc và tìm kiếm.
*   *Search fields:* `template.eventType`, `template.subject`.
*   *Filter fields:* `channel`, `language`, `isActive`.
*   *Sort fields:* `updated_at`.
*   *Format đầu ra:* `PaginatedResponseDto<NotificationTemplateEntity>`.

### 9.3. Cấu hình Tùy chọn Nhận thông báo (Preferences - Owner or Admin)
*   **Lấy tùy chọn:** `GET /api/v1/notification/preferences/:userId`
*   **Cập nhật tùy chọn:** `POST /api/v1/notification/preferences/:userId`
*   *Phân quyền ABAC:* Yêu cầu quyền `notification.preference.write`. Áp dụng kiểm tra `user.id == resource.userId` (Chuyên viên chỉ được xem/sửa tùy chọn của chính mình).

---

## 10. Đặc Tả ABAC Resource Hydrators của Module Notification
Để hỗ trợ `PermissionsGuard` kiểm duyệt quyền truy cập tùy chọn cấu hình của User:

1.  **`PreferenceHydrator` (Prefix nhận diện: `notification.preference`):**
    *   *Phương thức nạp:* `fetchResource(userId: string)`
    *   *SQL Select:* Chỉ lấy các trường `id`, `user_id`.
    *   *Áp dụng:* Bảo vệ các API liên quan đến `notification_preferences`.

---
