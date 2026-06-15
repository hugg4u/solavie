# Quy Chuẩn Ghi Log Module IAM

Tất cả log vận hành hệ thống và cảnh báo bảo mật từ Module IAM bắt buộc phải được ghi ra stdout ở định dạng JSON có cấu trúc để Promtail thu thập đưa về Grafana Loki.

---

## 1. Hệ Thống Audit Log Cơ Sở Dữ Liệu (Database Audit Log)
Đối với các thay đổi pháp lý về phân quyền nhân viên, dữ liệu được ghi trực tiếp vào bảng `iam_role_audit_logs` trong cơ sở dữ liệu để phục vụ thanh tra:

| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | Định danh bản ghi log |
| `actor_id` | UUID (FK) | Người thực hiện hành động (Admin) |
| `target_id` | UUID (FK) | Đối tượng bị tác động (Nhân viên) |
| `action` | VARCHAR(50) | `ROLE_ASSIGN`, `ROLE_REMOVE`, `PERMISSION_GRANT`, `PERMISSION_REVOKE` |
| `old_state` | JSONB | Trạng thái quyền hạn trước khi sửa |
| `new_state` | JSONB | Trạng thái quyền hạn sau khi sửa |
| `created_at` | TIMESTAMP | Thời điểm thực hiện |

---

## 2. Hệ Thống System Logs (Promtail & Grafana Loki)

Đồng thời, mọi thay đổi phân quyền cũng như các cảnh báo an ninh phải được in ra stdout dạng JSON.

### 2.1. Mẫu Log Audit Thay Đổi Quyền Hạn (Role & Permission Audit Log)
Ghi log khi một tài khoản Admin thực hiện thay đổi vai trò hoặc quyền hạn của nhân viên.

```json
{
  "timestamp": "2026-06-15T16:30:00.123Z",
  "level": "info",
  "module": "IAM",
  "context": "ROLE_MANAGEMENT_SERVICE",
  "message": "User roles updated successfully",
  "traceId": "t_iam_992102_trace",
  "metadata": {
    "actor_id": "usr_admin_uuid_112",
    "target_id": "usr_sales_uuid_445",
    "action": "ROLE_ASSIGN",
    "assigned_roles": ["SOLAR_SALES"],
    "ip_address": "14.226.50.88"
  }
}
```

### 2.2. Mẫu Log Phát Hiện Brute-Force Đăng Nhập (Brute-Force Attack Warning)
Ghi log cảnh báo mức `warn` khi một IP đăng nhập sai liên tiếp vượt ngưỡng an toàn (quá 5 lần trong 5 phút).

```json
{
  "timestamp": "2026-06-15T16:31:05.456Z",
  "level": "warn",
  "module": "IAM",
  "context": "AUTHENTICATION_SERVICE",
  "message": "Potential Brute-Force attack detected on user login",
  "traceId": "t_iam_992103_trace",
  "metadata": {
    "login_identifier": "sales_johndoe@solavie.com",
    "failed_attempts": 6,
    "ip_address": "103.82.25.10",
    "block_duration_minutes": 15
  }
}
```

### 2.3. Mẫu Log Chữ Ký JWT Không Hợp Lệ (Invalid JWT Signature warning)
Ghi log cảnh báo mức `warn` khi phát hiện token có chữ ký không hợp lệ, báo hiệu nỗ lực giả mạo token đăng nhập.

```json
{
  "timestamp": "2026-06-15T16:32:10.789Z",
  "level": "warn",
  "module": "IAM",
  "context": "JWT_AUTH_GUARD",
  "message": "Invalid JWT signature detected during token verification",
  "traceId": "t_iam_992104_trace",
  "metadata": {
    "token_header": {
      "alg": "HS256",
      "typ": "JWT"
    },
    "ip_address": "118.69.12.5",
    "raw_payload_sub": "usr_user_uuid_fake"
  }
}
```
