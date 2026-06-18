# Đặc Tả Business Logic Module IAM

## 1. Logic Xác Thực & Quản Lý Phiên (Authentication & Session Logic)

### 1.1. Luồng Đăng Nhập (Login Flow)

Khi người dùng gọi `POST /api/v1/iam/auth/login` với `{ email, password }`:

1. **Lookup User:** Truy vấn `iam_users` theo `email`. Nếu không tồn tại hoặc `is_active = false` → Trả về `401 Unauthorized` (không tiết lộ lý do cụ thể để tránh User Enumeration).
2. **Password Verification:** `bcrypt.compare(password, user.password_hash)`. Nếu `false` → Tăng counter brute-force trong Redis, trả về `401`.
3. **Brute-Force Check:** Nếu IP đăng nhập sai > 5 lần trong 5 phút → Khóa IP 15 phút, ghi log `warn`.
4. **Token Generation:**
   - Sinh `accessToken` (JWT, HS256, payload: `{ sub: userId, email, permissions: [...] }`, TTL = 15 phút).
   - Sinh `refreshToken` (32 bytes `crypto.randomBytes(32).toString('hex')`).
5. **Redis Storage:** Lưu `iam:refresh_token:${refreshToken}` → `{ userId, email, ipAddress, userAgent, issuedAt, expiresAt }` (TTL = 604800s = 7 ngày). *(Sử dụng Redis QUEUE instance - noeviction để không bị xóa khi đầy RAM)*
6. **Device Fingerprint:** So sánh `(ipAddress, userAgent)` với lịch sử đăng nhập của user. Nếu thiết bị mới → Emit `auth.login_new_device`.
7. **Response:** Trả về `{ accessToken, expireIn: 900 }` trong body. Set-Cookie `refresh_token=...` với flags `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/iam/auth`.

### 1.2. Luồng Làm Mới Token (Refresh Token Rotation)

Khi client gọi `POST /api/v1/iam/auth/refresh` với Cookie `refresh_token`:

```
1. Đọc refreshToken từ Cookie
2. Truy vấn Redis key iam:refresh_token:${refreshToken}
   ├── KEY KHÔNG TỒN TẠI → 401 Unauthorized
   └── KEY TỒN TẠI → Tiếp tục
3. [BREACH DETECTION] Kiểm tra: Token này đã bị thu hồi chưa?
   ├── Đã thu hồi (key bị xóa trước đó) → Thu hồi TOÀN BỘ phiên userId đó
   │   ├── Xóa tất cả iam:refresh_token:* của userId
   │   ├── Ghi log WARN: "Refresh Token Replay Detected"
   │   └── 401 Unauthorized
   └── Còn hợp lệ → Tiếp tục
4. Atomic Rotation:
   ├── Sinh accessToken mới
   ├── Sinh newRefreshToken mới (32 bytes random)
   ├── SET iam:refresh_token:${newRefreshToken} → {...} (TTL = 7 ngày)
   ├── DEL iam:refresh_token:${refreshToken}  [XÓA TOKEN CŨ NGAY LẬP TỨC]
   └── Set-Cookie newRefreshToken + Return accessToken
```

### 1.3. Luồng Đăng Xuất (Logout Flow)

Khi client gọi `POST /api/v1/iam/auth/logout`:

1. Đọc `refreshToken` từ Cookie.
2. `DEL iam:refresh_token:${refreshToken}` khỏi Redis.
3. `DEL user:permissions:${userId}` khỏi Redis cache.
4. Trả về response với header `Set-Cookie: refresh_token=; Max-Age=0` (xóa cookie ở client).

---

## 2. Logic Phân Quyền (Authorization Guard Evaluation)

Khi request chạm vào một API được bảo vệ (ví dụ `GET /api/v1/crm/customers/1` yêu cầu quyền `lead:read`):

### 2.1. Bước 1 — JWT Verification
- Guard đọc `Authorization: Bearer <token>`.
- Xác thực chữ ký JWT và kiểm tra thời hạn (`exp`). Nếu không hợp lệ → `401 Unauthorized` + ghi log `warn`.

### 2.2. Bước 2 — RBAC Check (Cache-First)
```
1. Kiểm tra Redis key user:permissions:${userId}
   ├── CACHE HIT → Đọc danh sách permissions từ cache (< 2ms)
   └── CACHE MISS → Query DB lấy permissions, ghi vào Redis (TTL = 3600s)
2. Kiểm tra danh sách permissions có chứa permission yêu cầu không
   ├── CÓ → Đi tiếp sang ABAC Check
   └── KHÔNG CÓ → 403 Forbidden
```

### 2.3. Bước 3 — ABAC Check (Nếu API có Policy động)
- Guard query DB lấy bản ghi resource (ví dụ: `customer` entity).
- Load `rule_expression` từ bảng `iam_policies`.
- Evaluate biểu thức: `user.id === customer.assignee_id`.
  - `true` → Cho phép.
  - `false` → `403 Forbidden`.

### 2.4. Bước 4 — Data Filtering bằng ABAC (Dành cho API danh sách GET)
Khi user gọi API lấy danh sách dữ liệu (Ví dụ: `GET /api/v1/crm/customers`), nếu thực thi ABAC bằng vòng lặp `for` trên tất cả dữ liệu trả về sẽ gây tràn RAM (OOM). Bắt buộc phải áp dụng **Data Filtering** bằng cách dịch Rule thành Query.
- JWT Payload chứa Context (Ví dụ: `userId`).
- Middleware sẽ xác định Role của user. Nếu không phải `ADMIN`, nó sẽ đính kèm Filter Logic vào Request.
- **Backend (TypeORM):** Sử dụng Query Builder ghép nối thêm điều kiện lọc:
  ```typescript
  // Nếu policy là "Chỉ được xem khách hàng của mình" (user.id == assignee_id)
  if (!isAdmin) {
    queryBuilder.andWhere('customer.assignee_id = :userId', { userId: req.user.id });
  }
  ```
- **Nguyên tắc cốt lõi:** Việc filtering dữ liệu (List) không giao phó hoàn toàn cho CASL hay kịch bản IAM Eval mà phải được chuyển đổi thành SQL Filter nằm ở Repositories để bảo vệ hiệu năng DB.

---

## 3. Logic Invalidate Cache Phân Quyền (Dynamic Cache Invalidation)

Khi Admin thay đổi Role/Permission của một nhân viên:

```typescript
@Injectable()
export class RoleManagementService {
  async assignRole(userId: string, roleId: string): Promise<void> {
    // 1. Lưu thay đổi vào PostgreSQL DB
    await this.userRoleRepository.save({ userId, roleId });

    // 2. Invalidate cache phân quyền ngay lập tức
    const cacheKey = `user:permissions:${userId}`;
    await this.redisCacheClient.del(cacheKey);

    // 3. Ghi Audit Log vào DB
    await this.auditLogRepository.save({ actorId, targetId: userId, action: 'ROLE_ASSIGN', ... });

    // 4. Ghi sự kiện Outbox (Sẽ được Worker quét và gửi đi)
    await this.outboxRepository.save({ 
        eventType: 'permission.changed', 
        payload: { eventId: uuidv4(), affectedUserId: userId, changedBy: actorId, ... }
    });
  }
}
```

---

## 4. Logic Tạo Tài Khoản & Kích Hoạt (Account Activation Flow)

### 4.1. Admin Tạo Nhân Viên Mới

```
POST /api/v1/iam/users
│
├── [IDEMPOTENCY GUARD] Check Idempotency-Key từ Header để chống thao tác tạo 2 lần
├── Validate DTO (email unique, roleId valid)
├── Bắt đầu Database Transaction
├── INSERT iam_users (password_hash = NULL, is_active = false)
├── INSERT iam_user_roles (userId, roleId)
│
├── [TOKEN GENERATION]
│   ├── rawToken = crypto.randomBytes(32).toString('hex')
│   └── sha256Hash = SHA256(rawToken)
│
├── [REDIS STORAGE]  →  Key: iam:activation:hash:${sha256Hash}
│   └── Value: { email, userId }   TTL: 86400s (24h)
│   [LƯU HASH, KHÔNG LƯU RAWTOKEN — bảo vệ nếu Redis bị breach]
│
├── [OUTBOX DB WRITE]  →  Ghi iam_outbox_events (auth.user_created)
│   └── Payload: { eventId: UUIDv4, userId, userEmail, userName, activationToken: rawToken, expireAt }
└── Commit Database Transaction
```

### 4.2. Trao Đổi Token Lấy Session SetupJWT (Token Exchange)

Khi người dùng click link email và Frontend gọi `POST /api/v1/iam/auth/exchange-activation-token` với `{ email, token: rawToken }`:

```
1. sha256Hash = SHA256(rawToken)
2. data = Redis.GET("iam:activation:hash:${sha256Hash}")
   ├── NULL hoặc data.email ≠ email → 400 Bad Request ("Link kích hoạt không hợp lệ hoặc đã hết hạn")
   └── Hợp lệ → Tiếp tục
3. Redis.DEL("iam:activation:hash:${sha256Hash}")   [XÓA NGAY - SINGLE USE]
4. Sinh SetupJWT:
   ├── Payload: { sub: userId, email, purpose: 'account_setup' }
   └── TTL: 300 giây (5 phút)
5. Ghi SetupJWT vào HttpOnly, Secure, SameSite=Strict Cookie
6. Trả về 200 OK: { message: "Token exchanged. Proceed to set password." }
```

### 4.3. Kích Hoạt Tài Khoản & Thiết Lập Mật Khẩu

Khi người dùng gọi `POST /api/v1/iam/auth/activate` với `{ password }`, kèm SetupJWT Cookie:

```
1. Đọc và giải mã SetupJWT từ Cookie
   ├── Không hợp lệ / Hết hạn → 401 Unauthorized
   └── purpose ≠ 'account_setup' → 401 Unauthorized
2. Password Strength Validation: tối thiểu 8 ký tự, có chữ hoa + chữ thường + số
3. passwordHash = bcrypt.hash(password, 10)
4. UPDATE iam_users SET password_hash = passwordHash, is_active = true WHERE id = userId
5. Xóa SetupJWT Cookie (Max-Age=0)
6. Trả về 200 OK: { message: "Tài khoản đã được kích hoạt thành công." }
```

### 4.4. Gửi Lại Link Kích Hoạt (Admin Resend)

Khi Admin gọi `POST /api/v1/iam/users/:id/resend-activation`:

```
1. Kiểm tra user tồn tại và is_active = false (chưa kích hoạt)
   └── is_active = true → 400 Bad Request ("Tài khoản đã được kích hoạt")
2. Quét và xóa key activation cũ trong Redis (nếu còn tồn tại)
3. Sinh rawToken mới và sha256Hash mới
4. Lưu key Redis mới (TTL = 86400s)
5. Emit auth.user_created để gửi lại email kích hoạt
```

---

## 5. Logic Đổi Mật Khẩu (Self-Service Change Password Flow)

Khi người dùng gọi `POST /api/v1/iam/users/me/change-password` với `{ oldPassword, newPassword }`:

```
1. [RE-AUTHENTICATION]
   ├── Truy vấn iam_users WHERE id = userId (từ AccessToken payload)
   ├── bcrypt.compare(oldPassword, user.password_hash)
   └── Kết quả FALSE → 400 Bad Request ("Mật khẩu cũ không chính xác")
       + Ghi log WARN: "Failed password change attempt - wrong current password"

2. [PASSWORD VALIDATION]
   ├── newPassword === oldPassword → 400 Bad Request ("Mật khẩu mới không được trùng mật khẩu cũ")
   └── newPassword không đủ độ mạnh → 400 Bad Request + chi tiết lỗi

3. [UPDATE PASSWORD]
   └── newPasswordHash = bcrypt.hash(newPassword, 10)
       UPDATE iam_users SET password_hash = newPasswordHash WHERE id = userId

4. [SESSION REVOCATION - Thu hồi TẤT CẢ phiên đăng nhập]
   ├── Scan và xóa tất cả key Redis: iam:refresh_token:* có userId tương ứng
   │   (Lưu trữ userId trong Redis hash để tra cứu nhanh)
   └── DEL user:permissions:${userId}  [Xóa cache phân quyền]

5. [EVENT EMIT]
   └── auth.password_changed → { userId, userEmail, ipAddress, userAgent, changedAt }
       → Notification Module gửi Email cảnh báo bảo mật
```

---

## 6. Logic Cập Nhật Hồ Sơ (Profile Update Logic)

Khi người dùng gọi `PATCH /api/v1/iam/users/me/profile` với `{ fullName?, avatarUrl? }`:

```
1. [AUTHORIZATION CHECK]
   └── userId từ AccessToken PHẢI khớp với tài khoản đang được sửa
       (Admin có thể sửa bất kỳ user nào)

2. [AVATAR_URL VALIDATION] (nếu có)
   ├── Phải là URL hợp lệ (regex validation)
   ├── Domain phải thuộc bucket user-media nội bộ
   └── Không hợp lệ → 400 Bad Request

3. [DB UPDATE]
   └── UPDATE iam_users SET full_name = ?, avatar_url = ? WHERE id = userId

4. Trả về thông tin user đã cập nhật (không bao gồm password_hash)
```
