# Đặc Tả Kỹ Thuật: Tích Hợp Google Calendar (Two-Way Sync)

Tài liệu này đặc tả cơ chế tích hợp Google Calendar vào Module Booking của Solavie, sử dụng luồng OAuth2 để cấp quyền và cơ chế Push Notifications (Webhook) để đồng bộ 2 chiều theo thời gian thực (Real-time).

---

## 1. Mục Tiêu Nghiệp Vụ
- **Cấp quyền (OAuth 2.0):** Nhân viên Sales có thể liên kết tài khoản Google Workspace/Gmail cá nhân để ủy quyền cho Solavie truy cập Lịch.
- **Đồng bộ Solavie -> Google (Ghi):** Khi có khách đặt lịch trên hệ thống Solavie, tự động tạo sự kiện (Event) trên Google Calendar của Sales kèm link Google Meet/Zoom và thông tin khách hàng.
- **Đồng bộ Google -> Solavie (Đọc Real-time):** Thay vì hệ thống phải liên tục Query API Google mỗi khi tính toán giờ trống (tốn kém và chậm), Google sẽ chủ động bắn Webhook về Solavie ngay khi Sales thêm/sửa/xóa một sự kiện trực tiếp trên app Google Calendar.

---

## 2. Thiết Kế Kiến Trúc (Architecture Design)

### 2.1. Cấu trúc dữ liệu liên kết
Hệ thống sử dụng bảng `booking_calendar_credentials` để lưu trữ thông tin xác thực từ Google. Bảng này phải được thiết kế bảo mật cao:
- **`refresh_token`**: Phải được mã hóa bằng thuật toán `AES-256-GCM` trước khi lưu xuống Database.
- **`sync_token`**: Dùng để hỗ trợ luồng Incremental Sync của Google (chỉ lấy các Event bị thay đổi kể từ lần đồng bộ cuối).

### 2.2. Luồng Cấp Quyền (OAuth2 Consent Flow)
1. **Request:** Người dùng (Sales) ấn nút "Kết nối Google Calendar" trên Agent Inbox UI.
2. **Redirect:** Frontend gọi Backend API, Backend trả về URL điều hướng sang trang đăng nhập Google (Yêu cầu scope: `https://www.googleapis.com/auth/calendar.events`).
3. **Callback:** Google trả về `authorization_code` qua Redirect URI.
4. **Exchange:** Backend đổi `code` lấy `access_token` và `refresh_token`.
5. **Encrypt & Store:** Mã hóa `refresh_token` và lưu vào Database.
6. **Watch Setup:** Backend lập tức gọi API `watch` của Google để đăng ký Webhook lắng nghe thay đổi của lịch này.

---

## 3. Cơ Chế Đồng Bộ (Sync Mechanisms)

### 3.1. Đồng bộ Google -> Solavie (Push Webhook)
Để đảm bảo Solavie tính toán thời gian rảnh (Available Slots) cực nhanh, dữ liệu lịch bận của Sales sẽ được lưu vào **Redis Cache** (`booking:busy_slots:{userId}`).

- Khi Sales sửa lịch trên Google, Google bắn POST Request (Webhook) tới `POST /api/v1/booking/webhooks/google-calendar`.
- Trong header của request có chứa `X-Goog-Channel-ID` (Định danh kênh theo dõi).
- Backend xác định được User tương ứng, gọi Google API sử dụng `sync_token` lưu trong DB để chỉ lấy đúng những Events bị sửa.
- Cập nhật lại những thay đổi đó vào `Redis Cache`.
- **Lưu ý Timeout:** Webhook Channel của Google Calendar có thời hạn (thường là 7 ngày). Backend cần chạy **CronJob (BullMQ)** mỗi ngày một lần để tự động `renew` các Channel sắp hết hạn.

### 3.2. Đồng bộ Solavie -> Google (Create/Cancel Event)
Khi có sự kiện `APPOINTMENT_SCHEDULED` từ hệ thống CRM/Chatbot:
1. Đọc `refresh_token` của Sales Rep (Host) từ Database, giải mã.
2. Sinh `access_token` mới nếu token cũ đã hết hạn.
3. Gọi API tạo Event trên Google Calendar (Insert Event).
4. **Bảo vệ Vòng lặp Vô hạn (Infinite Loop Guard):** Khi Solavie tạo Event trên Google, Google *cũng* sẽ bắn lại Webhook thay đổi lịch về cho Solavie. Để tránh Solavie xử lý lại chính sự kiện mình vừa tạo, trong trường `extendedProperties` của Google Event, Backend sẽ đính kèm khóa `solavie_appointment_id: {UUID}`. Khi nhận Webhook, nếu phát hiện khóa này, Backend sẽ **BỎ QUA** sự kiện đó.

---

## 4. Xử Lý Ngoại Lệ & Idempotency

- **Revoked Access:** Nếu Sales chủ động vào Tài khoản Google hủy quyền của App Solavie, `refresh_token` sẽ bị từ chối với lỗi `invalid_grant`. Khi đó, hệ thống sẽ đánh dấu `status = 'REVOKED'` trong DB và gửi thông báo In-App nhắc nhở Sales kết nối lại.
- **Webhook Retry:** Nếu server Solavie sập, Google sẽ tự động retry gửi Webhook với chiến lược Exponential Backoff. Do luồng đồng bộ lấy dữ liệu theo `sync_token` (Incremental Sync), hệ thống đảm bảo **Idempotency** (không bị lỗi dù nhận Webhook nhiều lần).
