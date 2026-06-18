# Yêu Cầu Chức Năng Module IAM (Identity & Access Management)

## 1. Giới Thiệu Module

Module IAM đảm nhận vai trò quản lý danh tính (Tài khoản nhân viên, Admin), cấp phát phiên đăng nhập (Authentication) và phân quyền kiểm soát truy cập linh hoạt (Authorization) vào toàn bộ hệ thống API Solavie.

---

## 2. Yêu Cầu Nghiệp Vụ

### 2.1. Authentication — Xác Thực Người Dùng

- Hệ thống sử dụng chiến lược **Dual Token** để quản lý phiên đăng nhập:
  - **Access Token (JWT):** Ký bằng thuật toán `HS256`, thời hạn **15 phút**. Payload chứa `userId`, `email`, danh sách `permissions` tĩnh.
  - **Refresh Token:** Chuỗi ngẫu nhiên bảo mật (32 bytes cryptographically secure), thời hạn **7 ngày**, lưu trữ tại Redis với key `iam:refresh_token:${refreshToken}` (NoEviction instance - Port 6380).
- **Refresh Token Rotation (Bắt buộc):** Mỗi lần gọi API `/refresh`, hệ thống phải:
  - Thu hồi ngay lập tức Refresh Token cũ (xóa key Redis).
  - Cấp phát Refresh Token mới và ghi vào Redis.
  - Trả về Access Token mới trong response body.
  - Ghi Refresh Token mới vào `HttpOnly`, `Secure`, `SameSite=Strict` Cookie.
- **Breach Detection (Phát Hiện Token Bị Đánh Cắp):** Nếu một Refresh Token đã bị thu hồi được sử dụng lại (token replay attack), hệ thống phải:
  - Phát hiện đây là hành vi bất thường.
  - **Thu hồi toàn bộ phiên đăng nhập** của user đó (xóa tất cả key `iam:refresh_token:*` liên quan đến userId).
  - Ghi log `warn` và phát cảnh báo bảo mật.
- **Lưu trữ mật khẩu:** Mọi mật khẩu phải được băm bằng thuật toán `Bcrypt` với `saltRounds = 10`. Không lưu mật khẩu thuần (plaintext) ở bất kỳ nơi nào.
- **Chống Brute-Force:** Nếu một địa chỉ IP đăng nhập sai liên tiếp quá **5 lần trong vòng 5 phút**, hệ thống phải khóa IP đó **15 phút** và ghi log `warn`.

### 2.2. Authorization — Phân Quyền Kiểm Soát Truy Cập

- Hỗ trợ **Role-Based Access Control (RBAC):** Các role hệ thống cứng như `ADMIN`, `MANAGER`, `SALES`.
- Hỗ trợ **Attribute-Based Access Control (ABAC):** Quyền động dựa trên thuộc tính dữ liệu. Ví dụ: Sales chỉ được xem và sửa khách hàng do mình phụ trách (`assignee_id`).
- Cấu trúc quyền (Permissions) phải chia theo từng action rõ ràng theo cú pháp `resource:action` (Ví dụ: `lead:read`, `lead:create`, `user:update`).
- Thông tin quyền hạn của mỗi user được cache tại Redis key `user:permissions:${userId}` (TTL = 3600 giây) để giảm tải DB.

### 2.3. Audit Trail — Ghi Vết Thay Đổi Quyền Hạn

- Bất kỳ Admin nào thực hiện thay đổi Role, cấp thêm hay xóa bớt Permission của một người dùng khác đều phải được ghi vào bảng `iam_role_audit_logs` trong Database (không thể xóa).
- Mọi hành vi ghi/sửa quyền hạn cũng phải được in ra stdout dạng JSON có cấu trúc để Promtail thu thập vào Grafana Loki.

### 2.4. Dynamic Cache Invalidation — Giải Phóng Cache Tức Thời

- **Yêu cầu real-time:** Khi Admin thay đổi vai trò (Role) hoặc gán/thu hồi quyền (Permission) của một nhân viên, thay đổi phải có hiệu lực **ngay ở request tiếp theo** của nhân viên đó — không có độ trễ.
- **Cơ chế:** Ngay sau khi lưu thay đổi vào PostgreSQL, hệ thống bắt buộc phải xóa key `user:permissions:${userId}` trên Redis. Guard sẽ tự động nạp lại quyền mới từ DB ở request tiếp theo.
- Tương tự, khi tài khoản bị khóa (`is_active = false`), cache phân quyền phải bị xóa ngay lập tức.

### 2.5. Security Event Notification — Phát Sự Kiện Bảo Mật

> **Nguyên tắc kiến trúc:** IAM Module không tự gửi thông báo trực tiếp. Chỉ phát sự kiện qua Event Bus nội bộ. Module Notification đảm nhận toàn bộ việc delivery.

| Sự kiện | Điều kiện kích hoạt | Payload bắt buộc | Notification Module xử lý |
|---|---|---|---|
| `auth.user_created` | Admin tạo nhân viên mới hoặc yêu cầu gửi lại link kích hoạt | `userId`, `userEmail`, `userName`, `activationToken` (rawToken), `expireAt` | Gửi **Email chào mừng** kèm link kích hoạt |
| `auth.login_new_device` | Đăng nhập từ IP/User-Agent chưa từng xuất hiện | `userId`, `userEmail`, `deviceInfo`, `ipAddress`, `loginTime` | Gửi **Email cảnh báo bảo mật** |
| `auth.password_changed` | Nhân viên đổi mật khẩu thành công | `userId`, `userEmail`, `ipAddress`, `userAgent`, `changedAt` | Gửi **Email cảnh báo bảo mật** |
| `permission.changed` | Admin thay đổi Role hoặc Permission của nhân viên | `affectedUserId`, `affectedUserEmail`, `changedBy`, `changeType`, `detail` | Gửi In-App + Email thông báo thay đổi quyền |

### 2.6. Profile & Avatar Management — Quản Lý Hồ Sơ Cá Nhân

- **Cập nhật thông tin cá nhân:** Nhân viên có quyền cập nhật `full_name` và `avatar_url` của chính mình qua API `PATCH /api/v1/iam/users/me/profile`.
- **Quy trình tải ảnh đại diện (Avatar Upload Workflow):**
  1. Client xin Pre-signed Upload URL từ Module Storage (public bucket `user-media`).
  2. Client upload file trực tiếp lên Storage.
  3. Client gọi API IAM với URL công khai của ảnh để lưu vào `avatar_url`.
- **Ràng buộc bảo mật:** Giá trị `avatar_url` phải là URL hợp lệ và phải trỏ tới domain bucket `user-media` nội bộ. Không chấp nhận URL từ domain bên ngoài.
- Chỉ cho phép tài khoản sở hữu cập nhật hồ sơ của chính mình. Admin có thể cập nhật hồ sơ của bất kỳ nhân viên nào.

### 2.7. User Management (CRU) & Account Activation — Quản Lý Nhân Viên & Kích Hoạt Tài Khoản

#### 2.7.1. Hành Vi Quản Trị (CRU)

- Chỉ Admin (quyền `user:create`) mới có thể tạo mới nhân viên. Tài khoản mới tạo sẽ **không có mật khẩu** (`password_hash = NULL`) và ở trạng thái **chờ kích hoạt** (`is_active = false`).
- Cho phép xem danh sách (`GET /api/v1/iam/users`) và chi tiết từng nhân viên (`GET /api/v1/iam/users/:id`) với phân trang, bộ lọc.
- Cho phép Admin cập nhật thông tin (`PATCH /api/v1/iam/users/:id`): họ tên, trạng thái hoạt động (`is_active`), vai trò (`roleId`).

#### 2.7.2. Quy Trình Kích Hoạt Tài Khoản (2-Step Token Exchange)

Hệ thống **không hỗ trợ** Forgot Password từ phía người dùng. Mọi việc cấp mật khẩu ban đầu đều do Admin chủ động thực hiện.

**Bước 1 — Admin tạo tài khoản:**
1. Tạo bản ghi user trong DB (`password_hash = NULL`, `is_active = false`).
2. Sinh `rawToken` (32 bytes cryptographically secure random).
3. Tính `sha256Hash = SHA256(rawToken)`.
4. Lưu vào Redis key `iam:activation:hash:${sha256Hash}` với giá trị `{ email, userId }`, TTL = **86400 giây (24 giờ)**. *(Lưu ý: Lưu hash, không lưu rawToken — bảo vệ khỏi Redis data breach)*
5. Phát sự kiện `auth.user_created` với `rawToken` để Notification gửi Email chứa link: `https://portal.solavie.vn/activate-account?token=${rawToken}&email=${email}`.

**Bước 2 — Người dùng click link (Token Exchange):**
1. Frontend gọi `POST /api/v1/iam/auth/exchange-activation-token` với `{ email, token: rawToken }`.
2. Backend tính `sha256Hash = SHA256(rawToken)`, tra cứu Redis key `iam:activation:hash:${sha256Hash}`.
3. Nếu không tồn tại hoặc email không khớp → Trả về `400 Bad Request`.
4. Nếu hợp lệ → **Xóa ngay lập tức key Redis** (đảm bảo single-use), sinh **SetupJWT** (payload: `{ userId, email, purpose: 'account_setup' }`, TTL = **5 phút**), ghi vào HttpOnly Cookie.

**Bước 3 — Người dùng thiết lập mật khẩu:**
1. Frontend gọi `POST /api/v1/iam/auth/activate` với `{ password }`, kèm theo SetupJWT Cookie.
2. Backend giải mã, validate SetupJWT (kiểm tra `purpose === 'account_setup'`).
3. Băm `password` bằng Bcrypt, cập nhật `password_hash` và `is_active = true`.
4. Xóa SetupJWT Cookie.

**Gửi lại link kích hoạt (Resend):**
- Admin gọi `POST /api/v1/iam/users/:id/resend-activation` (quyền `user:update`).
- Hệ thống xóa key Redis cũ (nếu còn tồn tại), sinh token mới và phát lại sự kiện `auth.user_created`.

### 2.8. Self-Service Password Change — Tự Đổi Mật Khẩu

- **Đối tượng:** Mọi nhân viên đã đăng nhập (có Access Token hợp lệ).
- **API:** `POST /api/v1/iam/users/me/change-password`, payload `{ oldPassword, newPassword }`.
- **Yêu cầu xác thực lại (Re-authentication):** Bắt buộc kiểm tra `oldPassword` bằng `bcrypt.compare()` với `password_hash` trong DB. Nếu sai → Trả về `400 Bad Request`. Không thực hiện tiếp bất kỳ thao tác nào.
- **Kiểm tra độ mạnh mật khẩu mới:** `newPassword` phải khác `oldPassword` và phải đạt yêu cầu độ phức tạp (tối thiểu 8 ký tự, bao gồm chữ hoa, chữ thường, số).
- **Thu hồi phiên (Session Revocation):** Sau khi đổi mật khẩu thành công, **toàn bộ Refresh Token** của user này phải bị thu hồi (xóa tất cả key `iam:refresh_token:*` liên quan). Key cache `user:permissions:${userId}` cũng phải bị xóa.
- **Cảnh báo bảo mật:** Phát sự kiện `auth.password_changed` qua Event Bus để Notification Module gửi Email cảnh báo.

---

## 3. Yêu Cầu Phi Chức Năng

| Hạng mục | Yêu cầu |
|---|---|
| **Bảo mật** | Không lưu mật khẩu thuần. Không gửi mật khẩu qua email. Token activation chỉ dùng được **một lần** (single-use). |
| **Hiệu năng** | Guard check quyền phải phản hồi < 2ms khi cache hit. |
| **Khả dụng** | Redis (noeviction) phải luôn sẵn sàng cho luồng refresh token và activation. |
| **Audit** | Mọi thay đổi quyền hạn phải ghi DB audit log không thể xóa. |
| **Tách biệt Redis** | `REDIS_QUEUE_URL` (Port 6380, noeviction) cho token/activation. `REDIS_CACHE_URL` (LRU) cho permission cache. |
