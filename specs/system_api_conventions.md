# Solavie Platform — API Conventions & Error Handling

| Tài liệu | API Conventions & Error Handling |
|---|---|
| Phiên bản | 1.0.0 |
| Ngày tạo | 2026-06-16 |

> Tài liệu này quy định chuẩn thống nhất cho toàn bộ API của hệ thống Solavie. Mọi module phải tuân thủ tuyệt đối.

---

## 1. URL Convention

```
/api/v{version}/{module}/{resource}[/{id}][/{sub-resource}]

Ví dụ:
  POST   /api/v1/iam/auth/login
  GET    /api/v1/crm/customers?page=1&limit=20
  PATCH  /api/v1/iam/users/me/profile
  POST   /api/v1/booking/appointments/:id/cancel
```

### Quy tắc:
- Luôn có prefix `/api/v1/`
- Tên resource dùng **kebab-case** và **số nhiều** (`customers`, `appointments`)
- Dùng **snake_case** cho query params (`page`, `limit`, `search_query`)
- Sub-resources dùng `/resource/:id/action` (không dùng query params cho hành động)

---

## 2. HTTP Method Conventions

| Method | Mục đích | Idempotent |
|---|---|---|
| `GET` | Đọc dữ liệu (không thay đổi state) | ✅ |
| `POST` | Tạo mới resource, hoặc action (login, exchange-token) | ❌ |
| `PATCH` | Cập nhật một phần resource | ✅ |
| `PUT` | Thay thế toàn bộ resource | ✅ |
| `DELETE` | Xóa resource (thường là soft delete) | ✅ |

---

## 3. Response Structure

### 3.1. Success Response
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Mô tả ngắn gọn",
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```
- `data`: Object (single) hoặc Array (list)
- `meta`: Chỉ có trong response danh sách (pagination)
- `message`: Tiếng Anh cho developer, Frontend hiển thị theo i18n

### 3.2. Error Response
```json
{
  "success": false,
  "statusCode": 400,
  "error": "BAD_REQUEST",
  "message": "Mô tả lỗi cho developer",
  "details": [
    { "field": "email", "message": "Email không hợp lệ" },
    { "field": "password", "message": "Mật khẩu phải có ít nhất 8 ký tự" }
  ],
  "traceId": "t_req_uuid_trace"
}
```
- `error`: Error code (string, UPPER_SNAKE_CASE)
- `message`: Mô tả kỹ thuật — **KHÔNG** lộ stack trace
- `details`: Mảng lỗi validation chi tiết (chỉ có khi là lỗi 400)
- `traceId`: Để tra cứu log trên Grafana Loki

---

## 4. HTTP Status Code Standards

| Code | Khi nào dùng |
|---|---|
| `200 OK` | Request thành công (GET, PATCH, DELETE) |
| `201 Created` | Tạo mới thành công (POST tạo resource) |
| `204 No Content` | Thành công nhưng không có data trả về (DELETE) |
| `400 Bad Request` | Dữ liệu đầu vào không hợp lệ (validation error) |
| `401 Unauthorized` | Chưa xác thực (no/invalid token) |
| `403 Forbidden` | Đã xác thực nhưng không có quyền |
| `404 Not Found` | Resource không tồn tại |
| `409 Conflict` | Dữ liệu trùng lặp (VD: email đã tồn tại) |
| `422 Unprocessable` | Request đúng format nhưng logic không thể xử lý |
| `429 Too Many Requests` | Rate limit / Brute-force block |
| `500 Internal Server Error` | Lỗi server không lường trước — log và alert |

---

## 5. Error Code Registry (Business Errors)

| Error Code | HTTP | Mô tả |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Sai email hoặc mật khẩu |
| `ACCOUNT_INACTIVE` | 401 | Tài khoản chưa kích hoạt |
| `TOKEN_EXPIRED` | 401 | Access/Refresh Token hết hạn |
| `TOKEN_INVALID` | 401 | Token không hợp lệ (sai chữ ký) |
| `TOKEN_REVOKED` | 401 | Token đã bị thu hồi |
| `SETUP_TOKEN_INVALID` | 401 | SetupJWT không hợp lệ hoặc hết hạn |
| `ACTIVATION_TOKEN_INVALID` | 400 | Link kích hoạt không hợp lệ hoặc đã dùng |
| `ACTIVATION_TOKEN_EXPIRED` | 400 | Link kích hoạt đã hết hạn (> 24h) |
| `WRONG_CURRENT_PASSWORD` | 400 | Mật khẩu cũ không chính xác |
| `PASSWORD_SAME_AS_OLD` | 400 | Mật khẩu mới trùng mật khẩu cũ |
| `PASSWORD_TOO_WEAK` | 400 | Mật khẩu không đủ độ mạnh |
| `ACCOUNT_ALREADY_ACTIVE` | 400 | Tài khoản đã được kích hoạt |
| `FORBIDDEN` | 403 | Không có quyền thực hiện hành động này |
| `RESOURCE_NOT_FOUND` | 404 | Resource không tồn tại |
| `EMAIL_ALREADY_EXISTS` | 409 | Email đã được đăng ký |
| `PHONE_ALREADY_EXISTS` | 409 | Số điện thoại đã tồn tại |
| `AVATAR_URL_INVALID` | 400 | URL ảnh đại diện không hợp lệ hoặc từ domain ngoài |
| `RATE_LIMIT_EXCEEDED` | 429 | Quá nhiều request trong thời gian ngắn |
| `IP_BLOCKED` | 429 | IP bị khóa do brute-force |
| `CONVERSATION_LOCKED` | 422 | Cuộc hội thoại đang bị khóa (AI đang xử lý) |
| `SLOT_NOT_AVAILABLE` | 409 | Khung giờ đặt lịch không còn trống |

---

## 6. Pagination Convention

### Request:
```
GET /api/v1/crm/customers?page=2&limit=20&search=nguyen&stage_id=uuid&assignee_id=uuid
```

### Response `meta`:
```json
{
  "page": 2,
  "limit": 20,
  "total": 150,
  "totalPages": 8
}
```

- Default: `page=1`, `limit=20`
- Max limit: `100`
- Sort: `sort_by=created_at&sort_order=DESC` (default)

---

## 7. Authentication Headers

```
Authorization: Bearer <accessToken>
```

- Áp dụng cho tất cả protected endpoints
- Cookie `refresh_token` được gửi tự động (HttpOnly) — không cần khai báo trong header

---

## 8. Idempotency Keys

Các API ghi dữ liệu nhạy cảm (tạo lịch hẹn, gửi thông báo) phải hỗ trợ Idempotency Key:

```
X-Idempotency-Key: <uuid-v4>
```

Nếu cùng Key được gửi 2 lần, server trả về response của lần đầu mà không xử lý lại.

Áp dụng bắt buộc cho:
- `POST /api/v1/booking/appointments` (tạo lịch hẹn)
- `POST /api/v1/iam/users` (tạo nhân viên)
- Notification delivery jobs

---

## 9. Rate Limiting

| Endpoint Group | Limit | Window |
|---|---|---|
| `POST /api/v1/iam/auth/login` | 10 req | 5 phút / IP |
| `POST /api/v1/iam/auth/refresh` | 30 req | 1 phút / user |
| `POST /api/v1/iam/auth/exchange-activation-token` | 5 req | 10 phút / IP |
| Tất cả protected APIs | 200 req | 1 phút / user |
| Public APIs (không auth) | 30 req | 1 phút / IP |

---

## 10. CORS & Security Headers

```
Access-Control-Allow-Origin: https://portal.solavie.vn
Access-Control-Allow-Credentials: true
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains
```
