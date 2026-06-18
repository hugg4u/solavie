# Quy Chuẩn Ghi Log Module IAM

Tất cả log vận hành hệ thống và cảnh báo bảo mật từ Module IAM bắt buộc phải được ghi ra **stdout** ở định dạng **JSON có cấu trúc** để Promtail thu thập và đưa về Grafana Loki.

> **Quy tắc chung:**
> - Field bắt buộc: `timestamp`, `level`, `module`, `context`, `message`, `traceId`, `metadata`
> - `level` sử dụng: `debug` | `info` | `warn` | `error`
> - `traceId` phải được truyền xuyên suốt từ Gateway để trace request end-to-end
> - Không bao giờ ghi `password`, `password_hash`, `refreshToken` (rawToken), hay `setupJwt` vào log

---

## 1. Database Audit Log — Bảng `iam_role_audit_logs`

Dùng để ghi vết thay đổi quyền hạn phục vụ thanh tra nội bộ. Dữ liệu ghi trực tiếp vào PostgreSQL (không thể xóa):

| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
|---|---|---|
| `id` | UUID (PK) | Định danh bản ghi log |
| `actor_id` | UUID (FK) | Admin thực hiện hành động |
| `target_id` | UUID (FK) | Nhân viên bị tác động |
| `action` | VARCHAR(50) | `ROLE_ASSIGN`, `ROLE_REMOVE`, `PERMISSION_GRANT`, `PERMISSION_REVOKE` |
| `old_state` | JSONB | Trạng thái quyền hạn trước khi sửa |
| `new_state` | JSONB | Trạng thái quyền hạn sau khi sửa |
| `ip_address` | VARCHAR(45) | IP của Admin thực hiện |
| `created_at` | TIMESTAMP | Thời điểm thực hiện |

---

## 2. Authentication Logs — Nhật Ký Xác Thực

### 2.1. Log Đăng Nhập Thành Công

```json
{
  "timestamp": "2026-06-16T03:00:00.123Z",
  "level": "info",
  "module": "IAM",
  "context": "AUTHENTICATION_SERVICE",
  "message": "User logged in successfully",
  "traceId": "t_iam_001001_trace",
  "metadata": {
    "user_id": "usr_sales_uuid_001",
    "user_email": "sales_01@solavie.com",
    "ip_address": "14.226.50.88",
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
    "is_new_device": false
  }
}
```

### 2.2. Log Đăng Nhập Từ Thiết Bị Mới (New Device Detected)

```json
{
  "timestamp": "2026-06-16T03:05:00.456Z",
  "level": "warn",
  "module": "IAM",
  "context": "AUTHENTICATION_SERVICE",
  "message": "Login detected from new device or IP. Security event emitted.",
  "traceId": "t_iam_001002_trace",
  "metadata": {
    "user_id": "usr_sales_uuid_001",
    "user_email": "sales_01@solavie.com",
    "ip_address": "118.69.200.55",
    "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)...",
    "event_emitted": "auth.login_new_device"
  }
}
```

### 2.3. Log Đăng Nhập Thất Bại (Wrong Password)

```json
{
  "timestamp": "2026-06-16T03:10:00.789Z",
  "level": "warn",
  "module": "IAM",
  "context": "AUTHENTICATION_SERVICE",
  "message": "Login failed - invalid credentials",
  "traceId": "t_iam_001003_trace",
  "metadata": {
    "login_identifier": "sales_01@solavie.com",
    "ip_address": "103.82.25.10",
    "failed_reason": "INVALID_PASSWORD"
  }
}
```

### 2.4. Log Phát Hiện Tấn Công Brute-Force

Ghi log cảnh báo `warn` khi một IP đăng nhập sai liên tiếp quá 5 lần trong 5 phút.

```json
{
  "timestamp": "2026-06-16T03:11:05.456Z",
  "level": "warn",
  "module": "IAM",
  "context": "AUTHENTICATION_SERVICE",
  "message": "Potential Brute-Force attack detected. IP temporarily blocked.",
  "traceId": "t_iam_001004_trace",
  "metadata": {
    "login_identifier": "sales_01@solavie.com",
    "failed_attempts": 6,
    "ip_address": "103.82.25.10",
    "block_duration_minutes": 15
  }
}
```

### 2.5. Log Đăng Xuất Thành Công

```json
{
  "timestamp": "2026-06-16T03:30:00.000Z",
  "level": "info",
  "module": "IAM",
  "context": "AUTHENTICATION_SERVICE",
  "message": "User logged out. Refresh token revoked.",
  "traceId": "t_iam_001005_trace",
  "metadata": {
    "user_id": "usr_sales_uuid_001",
    "ip_address": "14.226.50.88"
  }
}
```

---

## 3. Token Management Logs — Nhật Ký Quản Lý Token

### 3.1. Log Làm Mới Token Thành Công (Refresh Token Rotation)

```json
{
  "timestamp": "2026-06-16T03:15:00.123Z",
  "level": "info",
  "module": "IAM",
  "context": "AUTHENTICATION_SERVICE",
  "message": "Refresh token rotated successfully. New access token issued.",
  "traceId": "t_iam_002001_trace",
  "metadata": {
    "user_id": "usr_sales_uuid_001",
    "ip_address": "14.226.50.88",
    "new_token_expires_at": "2026-06-16T03:30:00.000Z"
  }
}
```

### 3.2. Log Phát Hiện Token Bị Phát Lại (Breach Detection — Token Replay Attack)

```json
{
  "timestamp": "2026-06-16T03:16:00.456Z",
  "level": "warn",
  "module": "IAM",
  "context": "AUTHENTICATION_SERVICE",
  "message": "SECURITY ALERT: Revoked refresh token reused. Possible token theft. All sessions revoked.",
  "traceId": "t_iam_002002_trace",
  "metadata": {
    "user_id": "usr_sales_uuid_001",
    "ip_address": "45.60.12.100",
    "action": "ALL_SESSIONS_REVOKED",
    "revoked_sessions_count": 3
  }
}
```

### 3.3. Log JWT Không Hợp Lệ (Invalid Signature)

```json
{
  "timestamp": "2026-06-16T03:17:10.789Z",
  "level": "warn",
  "module": "IAM",
  "context": "JWT_AUTH_GUARD",
  "message": "Invalid JWT signature detected during token verification",
  "traceId": "t_iam_002003_trace",
  "metadata": {
    "token_header": { "alg": "HS256", "typ": "JWT" },
    "ip_address": "118.69.12.5",
    "raw_payload_sub": "usr_fake_uuid"
  }
}
```

---

## 4. Authorization Cache Logs — Nhật Ký Cache Phân Quyền

### 4.1. Log Cache Hit

```json
{
  "timestamp": "2026-06-16T03:20:00.001Z",
  "level": "debug",
  "module": "IAM",
  "context": "PERMISSIONS_GUARD",
  "message": "Authorization cache hit",
  "traceId": "t_iam_003001_trace",
  "metadata": {
    "user_id": "usr_sales_uuid_001",
    "cache_key": "user:permissions:usr_sales_uuid_001"
  }
}
```

### 4.2. Log Cache Miss & Nạp Lại Từ DB

```json
{
  "timestamp": "2026-06-16T03:20:01.005Z",
  "level": "info",
  "module": "IAM",
  "context": "PERMISSIONS_GUARD",
  "message": "Authorization cache miss. Loading permissions from DB.",
  "traceId": "t_iam_003002_trace",
  "metadata": {
    "user_id": "usr_sales_uuid_001",
    "cache_key": "user:permissions:usr_sales_uuid_001",
    "loaded_permissions_count": 8,
    "db_query_time_ms": 15
  }
}
```

### 4.3. Log Xóa Cache Sau Thay Đổi Quyền

```json
{
  "timestamp": "2026-06-16T03:22:00.150Z",
  "level": "info",
  "module": "IAM",
  "context": "ROLE_MANAGEMENT_SERVICE",
  "message": "User authorization cache invalidated after role change",
  "traceId": "t_iam_003003_trace",
  "metadata": {
    "actor_id": "usr_admin_uuid_112",
    "target_user_id": "usr_sales_uuid_001",
    "cache_key": "user:permissions:usr_sales_uuid_001",
    "change_action": "ROLE_ASSIGN",
    "new_role": "MANAGER"
  }
}
```

---

## 5. Role & Permission Audit Logs — Nhật Ký Thay Đổi Quyền Hạn

### 5.1. Log Admin Thay Đổi Vai Trò Nhân Viên

```json
{
  "timestamp": "2026-06-16T03:22:00.123Z",
  "level": "info",
  "module": "IAM",
  "context": "ROLE_MANAGEMENT_SERVICE",
  "message": "User role updated by admin",
  "traceId": "t_iam_004001_trace",
  "metadata": {
    "actor_id": "usr_admin_uuid_112",
    "target_user_id": "usr_sales_uuid_001",
    "action": "ROLE_ASSIGN",
    "old_role": "SALES",
    "new_role": "MANAGER",
    "ip_address": "14.226.50.88"
  }
}
```

---

## 6. Account Activation Logs — Nhật Ký Kích Hoạt Tài Khoản

### 6.1. Log Admin Tạo Nhân Viên Mới

```json
{
  "timestamp": "2026-06-16T08:00:00.123Z",
  "level": "info",
  "module": "IAM",
  "context": "USER_MANAGEMENT_SERVICE",
  "message": "User account created. Activation token generated and stored in Redis.",
  "traceId": "t_iam_005001_trace",
  "metadata": {
    "admin_id": "usr_admin_uuid_112",
    "new_user_id": "usr_sales_uuid_789",
    "new_user_email": "new_sales@solavie.com",
    "activation_token_ttl_seconds": 86400,
    "redis_key": "iam:activation:hash:<sha256_hash_prefix_8_chars>...",
    "event_emitted": "auth.user_created"
  }
}
```

### 6.2. Log Trao Đổi Token Lấy SetupJWT (Token Exchange)

```json
{
  "timestamp": "2026-06-16T08:05:00.456Z",
  "level": "info",
  "module": "IAM",
  "context": "AUTHENTICATION_SERVICE",
  "message": "Activation token exchanged successfully for SetupJWT session",
  "traceId": "t_iam_005002_trace",
  "metadata": {
    "user_email": "new_sales@solavie.com",
    "ip_address": "171.244.10.22",
    "user_agent": "Mozilla/5.0...",
    "setup_jwt_expires_in_seconds": 300,
    "action": "TOKEN_EXCHANGE"
  }
}
```

### 6.3. Log Kích Hoạt Token Không Hợp Lệ Hoặc Đã Hết Hạn

```json
{
  "timestamp": "2026-06-16T08:05:30.100Z",
  "level": "warn",
  "module": "IAM",
  "context": "AUTHENTICATION_SERVICE",
  "message": "Activation token exchange failed - token not found or expired",
  "traceId": "t_iam_005003_trace",
  "metadata": {
    "user_email": "new_sales@solavie.com",
    "ip_address": "45.60.12.100",
    "reason": "TOKEN_NOT_FOUND_OR_EXPIRED"
  }
}
```

### 6.4. Log Kích Hoạt Tài Khoản Thành Công

```json
{
  "timestamp": "2026-06-16T08:06:12.789Z",
  "level": "info",
  "module": "IAM",
  "context": "AUTHENTICATION_SERVICE",
  "message": "User account activated successfully. Password set.",
  "traceId": "t_iam_005004_trace",
  "metadata": {
    "user_id": "usr_sales_uuid_789",
    "user_email": "new_sales@solavie.com",
    "ip_address": "171.244.10.22",
    "action": "ACCOUNT_ACTIVATION"
  }
}
```

### 6.5. Log Admin Gửi Lại Link Kích Hoạt (Resend)

```json
{
  "timestamp": "2026-06-16T09:00:00.000Z",
  "level": "info",
  "module": "IAM",
  "context": "USER_MANAGEMENT_SERVICE",
  "message": "Admin requested resend of activation link. Old token invalidated, new token issued.",
  "traceId": "t_iam_005005_trace",
  "metadata": {
    "admin_id": "usr_admin_uuid_112",
    "target_user_id": "usr_sales_uuid_789",
    "target_user_email": "new_sales@solavie.com",
    "event_emitted": "auth.user_created"
  }
}
```

---

## 7. Password Change Logs — Nhật Ký Thay Đổi Mật Khẩu

### 7.1. Log Đổi Mật Khẩu Thành Công

```json
{
  "timestamp": "2026-06-16T08:15:00.123Z",
  "level": "info",
  "module": "IAM",
  "context": "AUTHENTICATION_SERVICE",
  "message": "User password changed successfully. All active sessions revoked.",
  "traceId": "t_iam_006001_trace",
  "metadata": {
    "user_id": "usr_sales_uuid_789",
    "user_email": "new_sales@solavie.com",
    "ip_address": "171.244.10.22",
    "user_agent": "Mozilla/5.0...",
    "revoked_sessions_count": 2,
    "event_emitted": "auth.password_changed",
    "action": "PASSWORD_CHANGE"
  }
}
```

### 7.2. Log Đổi Mật Khẩu Thất Bại (Sai Mật Khẩu Cũ)

```json
{
  "timestamp": "2026-06-16T08:14:00.500Z",
  "level": "warn",
  "module": "IAM",
  "context": "AUTHENTICATION_SERVICE",
  "message": "Password change failed - old password mismatch",
  "traceId": "t_iam_006002_trace",
  "metadata": {
    "user_id": "usr_sales_uuid_789",
    "ip_address": "171.244.10.22",
    "reason": "WRONG_CURRENT_PASSWORD"
  }
}
```

---

## 8. Profile Update Logs — Nhật Ký Cập Nhật Hồ Sơ

### 8.1. Log Cập Nhật Hồ Sơ Thành Công

```json
{
  "timestamp": "2026-06-16T10:00:00.000Z",
  "level": "info",
  "module": "IAM",
  "context": "USER_MANAGEMENT_SERVICE",
  "message": "User profile updated successfully",
  "traceId": "t_iam_007001_trace",
  "metadata": {
    "user_id": "usr_sales_uuid_789",
    "updated_fields": ["full_name", "avatar_url"],
    "ip_address": "171.244.10.22"
  }
}
```

### 8.2. Log Avatar URL Không Hợp Lệ (Security Rejection)

```json
{
  "timestamp": "2026-06-16T10:01:00.000Z",
  "level": "warn",
  "module": "IAM",
  "context": "USER_MANAGEMENT_SERVICE",
  "message": "Profile update rejected - invalid or external avatar_url detected",
  "traceId": "t_iam_007002_trace",
  "metadata": {
    "user_id": "usr_sales_uuid_789",
    "rejected_url": "https://external-malicious-domain.com/evil.jpg",
    "reason": "EXTERNAL_DOMAIN_NOT_ALLOWED"
  }
}
```
