# Task Lập Trình Module Đặt Lịch Hẹn (Scheduling Module)

Kế hoạch lập trình và triển khai module Đặt Lịch Hẹn được phân chia thành các task cụ thể theo đúng đặc tả và thiết kế kỹ thuật đã được phê duyệt:

## Phase 1: Database & Schema Integration
- [ ] **Migration & Entities Creation:** Tạo file migration và định nghĩa Entities trong NestJS cho ba bảng mới:
  - `booking_event_types` (id, title, slug, duration, location_type, description, is_active, created_at).
  - `booking_availabilities` (id, user_id, day_of_week, start_time, end_time).
  - `booking_appointments` (id, event_type_id, host_id, customer_id, customer_name, customer_email, customer_phone, start_time, end_time, status, meeting_link, notes, created_at, updated_at).
- [ ] **Soft Relationships Config:** Định nghĩa các mối liên hệ mềm (soft links) sang bảng khách hàng `crm_customers` và bảng nhân viên `iam_users` tại service layer.

## Phase 2: Core Scheduling APIs
- [ ] **Event Types CRUD:** Xây dựng API và controller cho phép Admin quản lý các loại cuộc hẹn mẫu (`GET`, `POST`, `PUT` /api/v1/booking/event-types).
- [ ] **Sales Availability CRUD:** Triển khai API cho phép nhân viên Sales tùy chỉnh thời gian làm việc của mình theo tuần (`GET`, `POST` /api/v1/booking/availabilities).
- [ ] **Available Slots Calculation Service:** Triển khai `AvailableSlotsService` hiện thực hóa thuật toán sinh khung giờ trống (lọc trùng lịch DB, lọc trùng lịch Google Calendar, áp dụng Buffer Time 15p và Min Notice 2 tiếng).
- [ ] **Slots Query Endpoint:** Khai báo route public `GET /api/v1/booking/slots` để trả về danh sách khung giờ trống của Sales cho cổng Web Portal hoặc AI Chatbot.
- [ ] **ABAC Data Filtering cho Appointments:** Bổ sung logic QueryBuilder lọc `.andWhere('host_id = :userId')` nếu Role là SALES khi lấy danh sách cuộc hẹn.

## Phase 3: Booking & CRM Synchronization
- [ ] **Appointment Booking API:** Triển khai API `POST /api/v1/booking/appointments` cho phép đặt lịch hẹn.
- [ ] **Idempotency Guard:** Bổ sung cơ chế check `Idempotency-Key` qua Redis cho API Booking để tránh người dùng click đúp sinh lịch hẹn trùng lặp.
- [ ] **Round-Robin Host Allocation:** Tích hợp logic tự động gán Sales Rep xoay vòng dựa trên Redis pointer nếu khách không chỉ định Sales trực tiếp.
- [ ] **CRM Customer Sync:** Triển khai logic tự động tìm hoặc tạo hồ sơ khách hàng `crm_customers` khi đặt lịch thành công, tự động gán `assignee_id` cho Sales host.
- [ ] **CRM Activity Timeline Logging:** Tự động ghi nhận log hoạt động loại `APPOINTMENT_SCHEDULED` vào timeline `crm_activities` của khách hàng.
- [ ] **Cancel & Reschedule APIs:** Triển khai API hủy lịch và dời lịch hẹn, thực hiện cập nhật DB trạng thái `CANCELLED` hoặc `RESCHEDULED`.

## Phase 4: Event-Driven Notification Integration
- [ ] **AppointmentConfirmedEvent Class:** Tạo class `AppointmentConfirmedEvent` và `AppointmentCancelledEvent` trong `booking/events/` chứa đầy đủ payload (eventId, salesInfo, customerInfo, meetLink, locationType).
- [ ] **Ghi outbox appointment.confirmed:** Sau khi thao tác thành công, ghi bản ghi vào `booking_outbox_events` loại `appointment.confirmed` với payload.
- [ ] **Ghi outbox appointment.cancelled:** Trong `cancelAppointment()` và `rescheduleAppointment()`, ghi sự kiện `appointment.cancelled` vào bảng Outbox kèm `cancelReason`.
- [ ] **Booking Outbox Worker:** Dựng Cronjob/BullMQ Worker quét `booking_outbox_events` định kỳ và đẩy ra Event Bus, đổi trạng thái sang PROCESSED.
- [ ] **Xóa ReminderScheduler Service:** Loại bỏ `ReminderScheduler` cũ (nếu đã viết), dọn dependencies BullMQ khỏi `BookingModule` vì giờ đây được quản lý bởi `NotificationModule`.
- [ ] **Inject Sales Info:** Đảm bảo `AppointmentService` đã lookup và truyền `salesUser.full_name` và `salesUser.email` vào payload event (có thể query qua `IamUserRepository` qua soft link).

## Phase 5: AI Chatbot Integration
- [ ] **Slots Lookup Tool for AI:** Viết tool `get_booking_slots` tích hợp vào ReAct Agent của Chatbot.
- [ ] **Booking Tool for AI:** Viết tool `create_appointment` tích hợp vào ReAct Agent để cho phép AI tự tạo lịch cho khách trực tiếp qua hội thoại chat.

## Phase 6: Automated Testing & Verification
- [ ] **Slots Calculation Tests:** Viết unit tests kiểm tra thuật toán tính giờ trống dưới các kịch bản trùng lịch bận Google Calendar, trùng lịch hẹn DB và vi phạm Buffer Time.
- [ ] **Round-Robin Booking Tests:** Viết unit tests kiểm thử cơ chế xoay vòng phân bổ Sales khi nhiều khách book cùng lúc.
- [ ] **Event Outbox Tests:** Viết integration test kiểm tra `appointment.confirmed` và `appointment.cancelled` được ghi đúng vào Outbox thay vì emit thẳng.
