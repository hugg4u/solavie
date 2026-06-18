# Task Lập Trình Module IAM

## Phase 1: Core Auth & Permission Engine
- `[ ]` **Auth Service:** Viết luồng Hash Password (Bcrypt) và đăng nhập cấp phát Access Token (JWT), lưu Refresh Token (secure random string) vào Redis với key `iam:refresh_token:${refreshToken}` (TTL = 7 ngày).
- `[ ]` **HTTP-Only Cookie Configuration:** Đặt cấu hình API `/login` và `/refresh` trả về Refresh Token dưới dạng cookie `HttpOnly`, `Secure`, `SameSite=Strict`.
- `[ ]` **Refresh Token Rotation:** Xây dựng logic API `/refresh` thực hiện thu hồi token cũ, phát hành token mới (xoay vòng) và lưu trữ. Thêm logic Breach Detection (phát hiện phát lại token cũ $\rightarrow$ thu hồi toàn bộ phiên đăng nhập của user đó).
- `[ ]` **Logout Service:** API `/logout` xóa key Refresh Token trên Redis, xóa cache phân quyền và xóa cookie ở client.
- `[ ]` **JWT Strategy:** Viết Passport/Guard để xác thực Access Token từ `Authorization: Bearer <token>` trên mỗi HTTP request.
- `[ ]` **Permission Decorators:** Cài đặt các custom decorator để dán quyền lên Controller.
- `[ ]` **Dynamic Policy Engine:** Viết bộ parser để eval các chuỗi logic từ bảng `iam_policies`.
- `[ ]` **Audit Interceptor:** Viết NestJS Interceptor để tự động lưu vết các hành vi ghi/sửa trên module IAM xuống bảng `iam_role_audit_logs`.
- `[ ]` **Dynamic Cache Invalidation:** Viết logic xóa key cache Redis (`user:permissions:${userId}`) ngay sau khi có sự thay đổi quyền hạn/vai trò của nhân viên trong Admin service.


## Phase 2: Security Event Notification Integration
- `[ ]` **IamEventPayload DTOs:** Tạo các class `LoginNewDeviceEvent`, `PermissionChangedEvent` trong `iam/events/` chứa payload đầy đủ (userId, email, deviceInfo, ipAddress, changedBy, changeType, detail...).
- `[ ]` **Device Fingerprint Detection:** Trong `AuthService.login()`, thêm logic so sánh `(ip, user-agent)` với lịch sử đăng nhập (luu trong Redis hoặc DB). Nếu phát hiện thiết bị mới, emit sự kiện `auth.login_new_device`.
- `[ ]` **Emit auth.login_new_device:** Ghi sự kiện vào `iam_outbox_events` (có `eventId`) trong `AuthService.login()` chung với các tác vụ DB để gửi Email cảnh báo bảo mật.
- `[ ]` **Emit permission.changed:** Trong `RoleService.assignRole()` và `PermissionService.updatePermissions()`, sau khi cập nhật DB và invalidate cache thành công, ghi `permission.changed` vào `iam_outbox_events` kèm `affectedUserId`, `changedBy`, `changeType`, `detail`.
- `[ ]` **IAM Outbox Worker:** Dựng Cronjob/BullMQ định kỳ quét bảng `iam_outbox_events` (trạng thái PENDING) và publish vào Event Bus, sau đó đổi trạng thái thành PROCESSED.
- `[ ]` **Integration Tests:** Viết test kiểm tra:
  - Login từ IP mới → event `auth.login_new_device` được ghi vào Outbox.
  - Thay đổi role → Redis cache bị xóa → event `permission.changed` được ghi vào Outbox.
  - Login từ IP đã biết → không ghi event vào Outbox.

## Phase 3: Profile & Password Settings
- `[ ]` **Add avatar_url to TypeORM Entity:** Cập nhật `User` entity trong `src/iam/entities/user.entity.ts` để bổ sung trường `avatarUrl` (VARCHAR, nullable).
- `[ ]` **Update Profile API:** Xây dựng endpoint `PATCH /api/v1/iam/users/me/profile` cùng DTO `UpdateProfileDto` cho phép cập nhật `full_name` và `avatar_url`.
- `[ ]` **Validation logic:** Kiểm tra dữ liệu đầu vào của `avatar_url` (phải là định dạng URL hợp lệ và trỏ tới bucket `user-media` của hệ thống để tránh tiêm nhiễm link ngoài độc hại).
- `[ ]` **Self-Service Change Password API:** Xây dựng endpoint `POST /api/v1/iam/users/me/change-password` cùng DTO `ChangePasswordDto` nhận `oldPassword` và `newPassword`.
- `[ ]` **Re-authentication Verification:** Viết logic so khớp Bcrypt mật khẩu cũ của user.
- `[ ]` **Session & Cache Revocation:** Triển khai thu hồi toàn bộ Refresh Tokens của user và xóa key `user:permissions:${userId}` trong Redis.
- `[ ]` **Emit auth.password_changed:** Ghi event `auth.password_changed` vào bảng Outbox kèm metadata (userId, email, ip, userAgent) để gửi email bảo mật.
- `[ ]` **Unit & Integration Tests:** Viết test kiểm tra:
  - API cập nhật profile hoạt động đúng đắn, phản hồi đúng mã lỗi nếu sửa thông tin của tài khoản khác mà không có quyền Admin.
  - Đổi mật khẩu thành công (nhập đúng pass cũ), mật khẩu cũ không đúng báo lỗi 400.
  - Các active sessions cũ bị vô hiệu hóa sau khi đổi mật khẩu.


## Phase 4: User Management (CRU) & Activation Flow
- `[ ]` **CRU User Endpoints:** Xây dựng các API `POST /api/v1/iam/users`, `GET /api/v1/iam/users` (phân trang, bộ lọc), và `PATCH /api/v1/iam/users/:id` dành riêng cho Admin/Manager.
- `[ ]` **Redis Hashing for Activation:** Trong API tạo user, sinh random token 32 bytes, lưu `SHA256(token)` vào Redis key `iam:activation:hash:${sha256}` với TTL = 24h.
- `[ ]` **Emit auth.user_created:** Ghi sự kiện vào `iam_outbox_events` với Payload `UserCreatedEvent({ eventId, userId, userEmail, userName, activationToken, expireAt })`.
- `[ ]` **Token Exchange API:** Triển khai endpoint `POST /api/v1/iam/auth/exchange-activation-token`. Check token, xóa key trên Redis ngay lập tức (single-use), sinh ra SetupJWT có thời hạn 5 phút và lưu vào HTTP-Only cookie.
- `[ ]` **Password Setup & Activation API:** Triển khai endpoint `POST /api/v1/iam/auth/activate` giải mã cookie SetupJWT, hash mật khẩu bằng Bcrypt và cập nhật DB, chuyển `is_active = true`.
- `[ ]` **Resend Activation Link API:** Triển khai endpoint `POST /api/v1/iam/users/:id/resend-activation` cho phép Admin gửi lại mail kích hoạt.
- `[ ]` **Integration Tests:** Viết e2e test kiểm tra:
  - Admin tạo user -> kiểm tra key trong Redis là hash SHA256 -> click link đổi token thành SetupJWT cookie -> token trên Redis biến mất -> submit pass mới thành công -> is_active = true.
  - Click lần 2 vào link -> báo lỗi 400 Bad Request (Single-use).
  - Gọi API reset password mà không có SetupJWT cookie -> báo lỗi 401.

