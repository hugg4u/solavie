# Thiết Kế Kiến Trúc Module IAM (Design)

## 1. Mẫu Thiết Kế (Design Patterns)
- **Guard Pattern (NestJS)**: Xây dựng các RolesGuard và PermissionsGuard chắn trước mọi API Endpoints.
- **Decorator Pattern**: Đánh dấu các API Endpoint bằng custom decorators (e.g. `@RequirePermissions('lead:read')`).

## 2. Thiết Kế Database (Lược Đồ Quan Hệ)

### 2.1. Bảng `iam_users` (Nhân Viên)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | |
| `email` | VARCHAR(255) | Username |
| `password_hash` | VARCHAR(255) | Bcrypt hash |
| `full_name` | VARCHAR(255) | |
| `avatar_url` | VARCHAR(550) | Đường dẫn ảnh đại diện (lưu tại public bucket `user-media`) |
| `is_active` | BOOLEAN | |

### 2.2. Bảng `iam_roles` (Vai Trò)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | |
| `name` | VARCHAR(50) | `ADMIN`, `SALES` |
| `description` | TEXT | |

### 2.3. Bảng `iam_permissions` (Quyền Chi Tiết)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | |
| `action` | VARCHAR(100) | Định dạng resource:action (e.g. `lead:create`) |
| `description` | TEXT | |

### 2.4. Bảng `iam_policies` (ABAC Policies)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | |
| `name` | VARCHAR(100) | Tên policy |
| `rule_expression` | TEXT | Biểu thức điều kiện (`user.id == resource.assignee_id`) |

### 2.5. Các bảng nối (Junction tables)
- `iam_user_roles`: Nối User và Role.
- `iam_role_permissions`: Nối Role và Permission.

### 2.6. Bảng đệm sự kiện (Transactional Outbox)
- `iam_outbox_events`: Lưu trữ sự kiện (event_type, payload, status) trước khi phát hành, đảm bảo nguyên tắc ACID và chống mất mát sự kiện.

---

## 3. Thiết Kế Cache Phân Quyền & Giải Phóng Bộ Nhớ (Cache Invalidation)

Để tối ưu hóa thời gian xử lý của các Guard trên mỗi request và tránh truy vấn cơ sở dữ liệu liên tục cho mỗi API Call, hệ thống áp dụng cơ chế Cache lưu trữ thông tin quyền hạn của người dùng.

### 3.1. Quy hoạch Instance Redis Cache
- **Kết nối:** Kết nối tới `REDIS_CACHE_URL` (Tách biệt hoàn toàn với `REDIS_QUEUE_URL` của BullMQ và Lock).
- **Cấu hình Redis:** Chạy với chính sách giải phóng bộ nhớ `maxmemory-policy allkeys-lru` để tự động dọn dẹp các quyền của người dùng lâu không đăng nhập khi Redis bị đầy bộ nhớ RAM.

### 3.2. Cấu trúc Key & Dữ liệu lưu trữ (Cache Key Structure)
- **Tên Key (Redis Key):** `user:permissions:${userId}`
- **Thời gian hết hạn (TTL):** Thiết lập **3600 giây (1 giờ)**. Sau 1 giờ nếu người dùng vẫn hoạt động, hệ thống tự động nạp lại quyền từ DB.
- **Giá trị lưu trữ:** Dạng Stringified JSON chứa danh sách mảng các action quyền hạn chi tiết (ví dụ: `["lead:read", "lead:create"]`).

### 3.3. Sơ đồ Luồng Invalidation & Reload Cache
1.  **Khi có sự thay đổi quyền (Admin assign/revoke role):**
    - Gọi API lưu thay đổi vào PostgreSQL DB.
    - Xóa key `user:permissions:${userId}` trên Redis.
2.  **Request tiếp theo từ User đập vào Gateway/IAM Guard:**
    - Guard kiểm tra sự tồn tại của key `user:permissions:${userId}` trên Redis.
    - **Nếu cache hit:** Sử dụng dữ liệu trong cache để check quyền (Phản hồi tức thì < 2ms).
    - **Nếu cache miss:**
        - Truy vấn Database để gom nhóm vai trò, permissions của user.
        - Ghi kết quả quyền thu được vào Redis key `user:permissions:${userId}` với TTL = 3600.
        - Sử dụng kết quả vừa lấy từ DB để check quyền.

---

## 4. Thiết Kế API Endpoints Module IAM

### 4.1. Nhóm API Quản trị Nhân Viên (Admin / Manager Only)
*   **`POST /api/v1/iam/users`** (Tạo mới nhân viên)
    *   *Quyền yêu cầu:* `user:create` (Mặc định chỉ gán cho Role `ADMIN`)
    *   *Payload:* `{ email: string, fullName: string, roleId: string }`
    *   *Logic xử lý:*
        1. Tạo bản ghi trong `iam_users` (cột `password_hash` để trống hoặc null).
        2. Tạo bản ghi liên kết role tương ứng trong `iam_user_roles`.
        3. Sinh chuỗi `rawToken` ngẫu nhiên bảo mật (32 bytes cryptographically secure random).
        4. Tính toán `sha256Token = SHA256(rawToken)`.
        5. Lưu vào Redis `redis-queue` (Port 6380 - noeviction) với key `iam:activation:hash:${sha256Token}` giá trị là JSON `{ email, userId }`, thiết lập **TTL = 86400 giây (24 giờ)**.
        6. Ghi bản ghi sự kiện `auth.user_created` vào bảng `iam_outbox_events` chung DB Transaction với bước tạo User. Payload phải chứa `eventId` ngẫu nhiên để chống duplicate. Outbox Sweeper sẽ đọc và phát hành sự kiện này đi.
*   **`GET /api/v1/iam/users`** (Xem danh sách nhân viên)
    *   *Quyền yêu cầu:* `user:read` (Role `ADMIN` hoặc `MANAGER`)
    *   *QueryParams:* `page`, `limit`, `search`, `roleId`, `isActive`
*   **`GET /api/v1/iam/users/:id`** (Xem chi tiết nhân viên)
    *   *Quyền yêu cầu:* `user:read`
*   **`PATCH /api/v1/iam/users/:id`** (Cập nhật thông tin nhân viên)
    *   *Quyền yêu cầu:* `user:update` (Mặc định chỉ gán cho Role `ADMIN`)
    *   *Payload:* `{ fullName?: string, roleId?: string, isActive?: boolean }`
    *   *Logic xử lý:* Cập nhật DB PostgreSQL. Đồng thời thực hiện giải phóng cache phân quyền trên Redis `user:permissions:${id}` nếu có sự thay đổi vai trò hoặc khóa hoạt động tài khoản.
*   **`POST /api/v1/iam/users/:id/resend-activation`** (Admin yêu cầu gửi lại link kích hoạt/thiết lập mật khẩu)
    *   *Quyền yêu cầu:* `user:update` (Mặc định chỉ gán cho Role `ADMIN`)
    *   *Logic xử lý:* Tạo activation token mới (xóa token cũ nếu có trong Redis) và ghi bản ghi `auth.user_created` vào `iam_outbox_events` để Outbox Sweeper gửi lại email kích hoạt cho nhân viên đó.

### 4.2. Nhóm API Xác Thực Hệ Thống (Public)
*   **`POST /api/v1/iam/auth/login`** (Đăng nhập nhân viên)
    *   *Payload:* `{ email: string, password: string }`
    *   *Response Body:* `{ accessToken: string, expireIn: number }` (15 phút)
    *   *Set-Cookie:* `refresh_token=${refreshToken}; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/iam/auth`
    *   *Logic xử lý:*
        1. Tìm user theo `email` trong `iam_users` và kiểm tra trạng thái `is_active = true`.
        2. So khớp `password` bằng Bcrypt. Nếu sai $\rightarrow$ Trả về `401 Unauthorized`.
        3. Truy vấn các vai trò, quyền hạn của user.
        4. Sinh `accessToken` (JWT, HS256, 15m).
        5. Sinh `refreshToken` ngẫu nhiên bảo mật (32 bytes).
        6. Lưu Refresh Token vào Redis key `iam:refresh_token:${refreshToken}` dạng JSON `{ userId, email, ipAddress, userAgent, expiresAt }` (TTL = 7 ngày).
        7. Trả về Response body và Set-Cookie.
*   **`POST /api/v1/iam/auth/refresh`** (Quay vòng Refresh Token - Rotation)
    *   *Yêu cầu:* Cookie `refresh_token` hợp lệ.
    *   *Response Body:* `{ accessToken: string, expireIn: number }`
    *   *Set-Cookie:* `refresh_token=${newRefreshToken}; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/iam/auth`
    *   *Logic xử lý:*
        1. Đọc `refresh_token` từ Cookie.
        2. Truy vấn Redis key `iam:refresh_token:${refreshToken}`.
        3. Nếu không tìm thấy key $\rightarrow$ Trả về `401 Unauthorized`.
        4. Nếu khớp và còn hạn:
            *   Sinh Access Token mới.
            *   Sinh Refresh Token mới (`newRefreshToken`).
            *   Lưu token mới vào Redis với TTL mới, xóa ngay lập tức token cũ (`DEL iam:refresh_token:${refreshToken}`).
            *   Trả về response và đặt Set-Cookie token mới.
*   **`POST /api/v1/iam/auth/logout`** (Đăng xuất khỏi hệ thống)
    *   *Logic xử lý:*
        1. Đọc `refresh_token` từ cookie.
        2. Xóa key `iam:refresh_token:${refreshToken}` trong Redis.
        3. Xóa cache phân quyền `user:permissions:${userId}`.
        4. Trả về response kèm chỉ thị xóa Cookie `refresh_token`.

### 4.3. Nhóm API Thiết lập Tài Khoản (Public)
*   **`POST /api/v1/iam/auth/exchange-activation-token`** (Đổi URL Token lấy Session Kích Hoạt)
    *   *Payload:* `{ email: string, token: string }`
    *   *Logic xử lý:*
        1. Tính toán `sha256Token = SHA256(token)`.
        2. Truy vấn Redis key `iam:activation:hash:${sha256Token}`.
        3. Nếu không tồn tại hoặc email lưu trong Redis không khớp $\rightarrow$ Trả về `400 Bad Request`.
        4. Nếu khớp: Sinh một **SetupJWT** (chứa payload hạn chế: `{ userId, email, purpose: 'account_setup' }`) với thời hạn **5 phút (TTL = 300 giây)**.
        5. Ghi SetupJWT vào **HTTP-Only, Secure Cookie** gửi về cho client.
        6. **Xóa ngay lập tức** key `iam:activation:hash:${sha256Token}` trên Redis (đảm bảo token link chỉ dùng được một lần duy nhất).
*   **`POST /api/v1/iam/auth/activate`** (Kích hoạt tài khoản & Tạo mật khẩu)
    *   *Yêu cầu:* Phải kèm theo SetupJWT hợp lệ trong HTTP-Only Cookie từ bước trước.
    *   *Payload:* `{ password: string }`
    *   *Logic xử lý:*
        1. Giải mã và validate SetupJWT từ cookie. Nếu không hợp lệ $\rightarrow$ Trả về `401 Unauthorized`.
        2. Băm `password` bằng Bcrypt và cập nhật cột `password_hash` của user.
        3. Chuyển trạng thái tài khoản thành hoạt động (`is_active = true`).
        4. Xóa SetupJWT cookie khỏi trình duyệt.
        5. Trả về thông báo kích hoạt tài khoản thành công.
*   *Lưu ý bảo mật:* Hệ thống không cung cấp API tự phục hồi mật khẩu (Forgot Password) từ phía Client. Quyền reset mật khẩu thuộc về người quản trị (Admin).

### 4.4. Nhóm API Tự Phục Vụ (Self-Service)
*   **`POST /api/v1/iam/users/me/change-password`** (Đổi mật khẩu tài khoản)
    *   *Yêu cầu:* Phải có Access Token hợp lệ (Đã đăng nhập).
    *   *Payload:* `{ oldPassword, newPassword }`
    *   *Logic xử lý:*
        1. Lấy `userId` từ context đăng nhập (AccessToken payload).
        2. Truy vấn user trong DB PostgreSQL, đối chiếu `oldPassword` với `password_hash` bằng Bcrypt. Nếu không khớp $\rightarrow$ Trả về `400 Bad Request` ("Mật khẩu cũ không chính xác").
        3. Băm `newPassword` bằng Bcrypt và cập nhật vào `password_hash`.
        4. Hủy bỏ tất cả Refresh Tokens hiện tại của user này trong DB/Redis (đăng xuất khỏi các thiết bị khác).
        5. Xóa key Redis cache phân quyền `user:permissions:${userId}`.
        6. Emit event `auth.password_changed` qua Event Bus để gửi email cảnh báo bảo mật.



