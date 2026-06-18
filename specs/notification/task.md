# Task List — Triển Khai Module Notification

## Phase A: Chuẩn Bị Tài Liệu & Specs ✅

- [x] **A1**: Tạo `specs/notification/requirement.md`
- [x] **A2**: Tạo `specs/notification/design.md`
- [x] **A3**: Tạo `specs/notification/business_logic.md`
- [x] **A4**: Tạo `specs/notification/logging.md`
- [x] **A5**: Tạo `specs/notification/task.md` (file này)
- [ ] **A6**: Cập nhật `docs/architecture_design.md` — Thêm NotificationModule vào diagram + section §3.7
- [ ] **A7**: Cập nhật `docs/database_schema.md` — Thêm 3 bảng notification mới

## Phase B: Cập Nhật Specs Module Liên Quan (Transactional Outbox) ✅

- [ ] **B1**: Cập nhật `specs/booking/requirement.md §2.5` — Refactor: Booking sử dụng Transactional Outbox để publish event.
- [ ] **B2**: Cập nhật `specs/chatbot/requirement.md §2.5` — Ghi rõ ghi event `chat.handover_requested` vào Outbox.
- [ ] **B3**: Cập nhật `specs/inbox/requirement.md §2.4` — Ghi rõ ghi event `inbox.agent_mentioned` vào Outbox.
- [ ] **B4**: Cập nhật `specs/crm/requirement.md` — Thêm §2.9 về ghi events `lead.assigned`, `lead.score_hot` vào Outbox.
- [ ] **B5**: Cập nhật `specs/iam/requirement.md` — Thêm §2.5 về ghi events `auth.login_new_device`, `permission.changed` vào Outbox.

## Phase C: Triển Khai Mã Nguồn

### C.1 — Module Setup & Database
- [ ] **C1.1**: Tạo `src/notification/notification.module.ts` (NestJS Module declaration)
- [ ] **C1.2**: Tạo migration database: `notification_preferences`, `notification_templates`, `notification_logs`
- [ ] **C1.3**: Tạo entities TypeORM: `NotificationPreferenceEntity`, `NotificationTemplateEntity`, `NotificationLogEntity`
- [ ] **C1.4**: Tạo repositories tương ứng

### C.2 — Core Services
- [ ] **C2.1**: Implement `IdempotencyService` (SHA256 key generation + DB check)
- [ ] **C2.2**: Implement `PreferenceService` (lookup + quiet hours check + event override check)
- [ ] **C2.3**: Implement `TemplateEngineService` (Handlebars renderer + template lookup)
- [ ] **C2.4**: Implement `NotificationRouter` (fan-out logic + channel decision matrix)
- [ ] **C2.5**: Implement `NotificationService` (main orchestrator + @OnEvent handlers cho tất cả 13 event types)

### C.3 — Provider Pattern
- [ ] **C3.1**: Định nghĩa `INotificationProvider` interface
- [ ] **C3.2**: Implement `InAppProvider` (Socket.io direct emit — Tier 1 Critical)
- [ ] **C3.3**: Implement `EmailProvider` (Nodemailer + AWS SES transport)
- [ ] **C3.4**: Implement `ZaloProvider` (Zalo ZNS API client + Fallback logic)
- [ ] **C3.5**: Tạo `ProviderRegistry` (factory để inject đúng provider theo channel)

### C.4 — BullMQ Queues & Workers
- [ ] **C4.1**: Định nghĩa 3 BullMQ queues: `email-notification-queue`, `zalo-notification-queue`, `scheduled-notification-queue`
- [ ] **C4.2**: Implement `EmailWorker` (BullMQ Processor + error handling + log update)
- [ ] **C4.3**: Implement `ZaloWorker` (BullMQ Processor + ZNS API call + fallback email)
- [ ] **C4.4**: Implement `ScheduledWorker` (Delayed job processor — reminder 24h + 1h)
- [ ] **C4.5**: Implement DLQ handling (after maxAttempts exceeded)

### C.5 — Integration với Event Bus (Message Broker Subscribers)
Thay vì sử dụng `EventEmitter` nội bộ cục bộ, Notification Module sẽ triển khai các Consumers/Subscribers kết nối với Event Bus để nhận sự kiện từ Outbox của các module khác:
- [ ] **C5.1**: Tạo subscriber hứng sự kiện `chat.handover_requested` từ Chatbot Module.
- [ ] **C5.2**: Tạo subscriber hứng sự kiện `inbox.agent_mentioned` từ Inbox Module.
- [ ] **C5.3**: Tạo subscriber hứng sự kiện `lead.assigned` và `lead.score_hot` từ CRM Module.
- [ ] **C5.4**: Tạo subscriber hứng sự kiện `appointment.confirmed` và `appointment.cancelled` từ Booking Module.
- [ ] **C5.5**: Tạo subscriber hứng sự kiện IAM (`auth.login_new_device`, `permission.changed`, `auth.user_created`, `auth.password_changed`) từ IAM Module.

### C.6 — Configuration & DevOps
- [ ] **C6.1**: Thêm env vars vào `docker-compose.yml`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `AWS_SES_REGION`, `ZALO_OA_ID`, `ZALO_OA_ACCESS_TOKEN`, `ZALO_ZNS_SECRET_KEY`
- [ ] **C6.2**: Cập nhật `specs/devops/design.md` với các biến môi trường mới

## Phase D: Kiểm Thử & Nghiệm Thu

- [ ] **D1**: Unit test `IdempotencyService` — duplicate detection
- [ ] **D2**: Unit test `PreferenceService` — quiet hours, opt-out, event override
- [ ] **D3**: Unit test `TemplateEngineService` — Handlebars rendering với biến động
- [ ] **D4**: Unit test `NotificationRouter` — fan-out logic cho từng event type
- [ ] **D5**: Integration test: `appointment.confirmed` event → 2 Email jobs + 1 Zalo job enqueued + 2 Scheduled jobs
- [ ] **D6**: Integration test: `appointment.cancelled` → scheduled jobs bị hủy + cancellation notification gửi
- [ ] **D7**: Integration test: `chat.handover_requested` → In-App WebSocket delivery < 500ms
- [ ] **D8**: Test Idempotency: cùng event gửi 2 lần → chỉ 1 notification delivered
- [ ] **D9**: Test DLQ: EmailProvider throw exception 3 lần → job vào DLQ + log FAILED
- [ ] **D10**: Test Zalo Fallback: `zalo_user_id = null` → tự động chuyển gửi Email
- [ ] **D11**: Test Quiet Hours: Email bị chặn trong giờ cấm → In-App vẫn hoạt động
