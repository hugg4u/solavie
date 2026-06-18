# Yêu Cầu Chức Năng Module Notification (Requirements)

## 1. Giới Thiệu Module

Module Notification đóng vai trò là **Hệ thống Thần kinh Ngoại biên** của Solavie Platform — tiếp nhận tín hiệu (Events) từ tất cả các module nội bộ (CRM, Booking, Chatbot, Inbox, IAM) và chuyển hóa chúng thành các thông báo hành động có ý nghĩa trên nhiều kênh giao tiếp, bao gồm cả thông báo *nội hệ thống* (In-App) lẫn *ngoại hệ thống* (Email, Zalo OA).

Module này hoạt động hoàn toàn theo mô hình **sự kiện bị động (Event-Driven Consumer)** — chỉ lắng nghe và phản hồi, tuyệt đối không chủ động truy vấn cơ sở dữ liệu của các module khác.

---

## 2. Các Yêu Cầu Nghiệp Vụ Chính (Business Requirements)

### 2.1. Hỗ Trợ Đa Kênh Thông Báo (Multi-Channel Delivery)

Hệ thống phải hỗ trợ gửi thông báo qua **3 kênh** chính:

| Kênh | Đối tượng | Mô tả |
|------|-----------|-------|
| **In-App (WebSocket)** | Nhân viên Sales / Manager | Thông báo thời gian thực trực tiếp trên Sales Portal qua Socket.io. Đây là kênh ưu tiên cao nhất cho tất cả thông báo nội bộ. |
| **Email** | Nhân viên Sales + Khách hàng | Gửi email qua AWS SES / SMTP cho các sự kiện giao dịch (Booking confirmation, reminder). |
| **Zalo OA (ZNS)** | Khách hàng | Gửi tin nhắn Zalo Notification Service (ZNS) cho khách hàng đã follow OA Solavie. Chỉ dùng cho tin nhắn giao dịch được phê duyệt bởi Zalo. |

> **Không triển khai SMS** trong Phase 1. Có thể bổ sung ở Phase 2 khi có hợp đồng nhà cung cấp.

### 2.2. Ánh Xạ Sự Kiện — Kênh (Event-to-Channel Mapping)

Mỗi event từ hệ thống phải kích hoạt đúng kênh thông báo tương ứng:

| Event | Module phát | Người nhận | In-App | Email | Zalo OA |
|-------|-------------|-----------|:------:|:-----:|:-------:|
| `chat.handover_requested` | Chatbot | Sales Rep (Round-Robin) | ✅ CRITICAL | ❌ | ❌ |
| `inbox.agent_mentioned` | Inbox | Sales được @tag | ✅ CRITICAL | ❌ | ❌ |
| `inbox.new_message` | Inbox | Sales Rep được gán | ✅ | ❌ | ❌ |
| `lead.assigned` | CRM | Sales Rep mới được gán | ✅ | ✅ | ❌ |
| `lead.score_hot` | CRM | Sales Rep + Manager | ✅ | ✅ | ❌ |
| `lead.status_changed` | CRM | Sales Rep được gán | ✅ | ❌ | ❌ |
| `customer.note_mentioned` | CRM | Sales được @mention | ✅ | ❌ | ❌ |
| `appointment.confirmed` | Booking | Sales Rep + Khách hàng | ✅ (Sales) | ✅ (cả 2) | ✅ (Khách) |
| `appointment.cancelled` | Booking | Sales Rep + Khách hàng | ✅ (Sales) | ✅ (cả 2) | ✅ (Khách) |
| `appointment.reminder_24h` | Booking | Sales Rep + Khách hàng | ✅ (Sales) | ✅ (cả 2) | ✅ (Khách) |
| `appointment.reminder_1h` | Booking | Sales Rep + Khách hàng | ✅ (Sales) | ✅ (cả 2) | ✅ (Khách) |
| `auth.login_new_device` | IAM | Tài khoản bị truy cập | ❌ | ✅ | ❌ |
| `permission.changed` | IAM | Nhân viên bị thay đổi quyền | ✅ | ✅ | ❌ |
| `auth.user_created` | IAM | Nhân viên mới được tạo | ❌ | ✅ | ❌ |
| `auth.password_changed` | IAM | Đổi mật khẩu thành công | ❌ | ✅ | ❌ |

### 2.3. Phân Tầng Ưu Tiên Gửi Thông Báo (Delivery Priority Tiers)

Hệ thống phân loại thông báo thành 3 tầng ưu tiên để đảm bảo thời gian phản hồi phù hợp:

- **Tier 1 — CRITICAL (Real-time, mục tiêu < 500ms):**
  - Áp dụng cho: `chat.handover_requested`, `inbox.agent_mentioned`, `inbox.new_message`.
  - Cơ chế: Gửi **trực tiếp qua Socket.io** mà không qua hàng đợi BullMQ, tránh độ trễ enqueue/dequeue.

- **Tier 2 — TRANSACTIONAL (Near real-time, mục tiêu < 5s):**
  - Áp dụng cho: `appointment.confirmed`, `appointment.cancelled`, `lead.assigned`, `lead.score_hot`, `permission.changed`.
  - Cơ chế: Enqueue vào **BullMQ jobs** với độ ưu tiên cao.

- **Tier 3 — SCHEDULED (BullMQ Delayed Jobs):**
  - Áp dụng cho: `appointment.reminder_24h`, `appointment.reminder_1h`.
  - Cơ chế: Job được lên lịch trễ (`delay`) tính từ thời điểm cuộc hẹn được xác nhận.

### 2.4. Quản Lý Tùy Chọn Thông Báo (User Notification Preferences)

- Mỗi nhân viên Sales/Manager có thể tùy chỉnh kênh nhận thông báo của mình thông qua trang cài đặt cá nhân:
  - Bật/tắt kênh Email cho từng loại sự kiện.
  - Cấu hình **Quiet Hours** (ví dụ: không gửi Email trong khoảng 22:00 - 07:00).
- Thông báo In-App WebSocket luôn được gửi bất kể cài đặt Quiet Hours (vì Sales đang online thì họ muốn nhận thông báo).
- **Thông báo cho Khách hàng** (Email, Zalo ZNS về cuộc hẹn) không bị ảnh hưởng bởi Quiet Hours của nhân viên.

### 2.5. Quản Lý Template Thông Báo (Notification Templates)

- Hệ thống phải có cơ chế quản lý template tập trung cho nội dung thông báo qua Email và Zalo ZNS.
- Template hỗ trợ biến động (Dynamic Variables) được render bằng Handlebars (ví dụ: `{{customer_name}}`, `{{appointment_time}}`).
- Admin có quyền cập nhật nội dung template qua API mà không cần deploy lại code.
- Mỗi template phân biệt theo: `event_type`, `channel`, và `language` (`vi` / `en`).

### 2.6. Chống Gửi Trùng Lặp (Idempotency Guarantee)

- Mỗi thông báo phải được gắn một **Idempotency Key** duy nhất được tạo theo công thức:
  `SHA256(event_type + ":" + entity_id + ":" + recipient_id + ":" + channel)`
- Trước khi gửi, hệ thống kiểm tra key này trong bảng `notification_logs`. Nếu đã tồn tại ở trạng thái `SENT`, bỏ qua việc gửi lại.
- Cơ chế này đảm bảo tính an toàn khi Event Bus gặp sự cố và phát lại (replay) event.

### 2.7. Audit Trail & Dead-Letter Queue (DLQ)

- **Audit Trail**: Mọi thông báo (kể cả thông báo bị bỏ qua do preference hoặc idempotency) phải được ghi nhận vào bảng `notification_logs` với trạng thái tương ứng: `QUEUED`, `PROCESSING`, `SENT`, `FAILED`, `SKIPPED`.
- **Dead-Letter Queue**: Các job thất bại sau 3 lần retry phải được chuyển sang DLQ để Admin có thể xem xét và xử lý thủ công qua Bull Board Dashboard.
- **Retry Policy**: Áp dụng Exponential Backoff với delay ban đầu 5s, tối đa 3 lần retry.

### 2.8. Đặc Thù Tích Hợp Zalo OA (ZNS Compliance)

- ZNS (Zalo Notification Service) chỉ cho phép gửi tin nhắn giao dịch (transactional) đã được Zalo phê duyệt template.
- Khách hàng **phải follow** Zalo OA của Solavie mới nhận được ZNS.
- Hệ thống phải kiểm tra trường `zalo_user_id` trong dữ liệu khách hàng trước khi gửi. Nếu không có → fallback sang Email.
- ZNS không dùng cho tin nhắn marketing hay thông báo nội bộ nhân viên.

---

## 3. Chỉ Số Hiệu Năng (KPIs)

| Chỉ số | Mục tiêu |
|--------|----------|
| Thời gian gửi Tier 1 (In-App WebSocket) | < 500ms |
| Thời gian xử lý Tier 2 (Email / Zalo ZNS) | < 5 giây (từ lúc event vào queue đến lúc gửi xong) |
| Tỷ lệ gửi thành công (Email) | ≥ 99% |
| Tỷ lệ gửi thành công (Zalo ZNS) | ≥ 95% (phụ thuộc Zalo API SLA) |
| Chống trùng lặp Idempotency | 100% — không bao giờ gửi 2 lần cùng thông báo |
