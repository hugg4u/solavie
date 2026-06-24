# Solavie Platform — Redis Key Registry

| Tài liệu | Redis Key Registry (Global) |
|---|---|
| Phiên bản | 1.0.0 |
| Ngày tạo | 2026-06-16 |

> **Nguyên tắc:** Mọi Redis key được sử dụng trong hệ thống phải được đăng ký tại đây. Tuyệt đối không tự ý tạo key pattern mới mà không cập nhật tài liệu này.

---

## 1. Phân Bổ Redis Instance

| Instance | Biến môi trường | Port | Policy | Mục đích |
|---|---|---|---|---|
| `redis-cache` | `REDIS_CACHE_URL` | 6379 | `allkeys-lru` | Cache có thể tái sinh |
| `redis-queue` | `REDIS_QUEUE_URL` | 6380 | `noeviction` + AOF | Dữ liệu không được phép mất |

---

## 2. Registry Keys Theo Module

### 2.1. Module IAM

| Key Pattern | Instance | TTL | Giá trị lưu | Mô tả |
|---|---|---|---|---|
| `iam:refresh_token:${refreshToken}` | `queue` | 604800s (7d) | `{ userId, email, ipAddress, userAgent, issuedAt, expiresAt }` | Refresh Token session |
| `iam:activation:hash:${sha256Hash}` | `queue` | 86400s (24h) | `{ email, userId }` | Link kích hoạt tài khoản (lưu hash SHA256 của rawToken) |
| `iam:brute_force:${ip}` | `cache` | 300s (5m) | `{ count: number }` | Đếm số lần đăng nhập sai / IP |
| `iam:ip_block:${ip}` | `cache` | 900s (15m) | `1` | Khóa IP sau brute-force |
| `user:permissions:${userId}` | `cache` | 3600s (1h) | `["lead:read", "lead:create", ...]` | Cache phân quyền nhân viên |

> ⚠️ **Lưu ý bảo mật:** Key `iam:activation:hash:*` lưu **hash SHA256** của token, KHÔNG bao giờ lưu rawToken. rawToken chỉ tồn tại trong email gửi cho người dùng và payload event.

### 2.2. Module Gateway & Chatbot

| Key Pattern | Instance | TTL | Giá trị lưu | Mô tả |
| --- | --- | --- | --- | --- |
| `gw:providers:configured` | `cache` | 300s (5m) | `[{providerId, name, ...}]` | Cache cấu hình providers hoạt động (masked API key) |
| `cooldown:provider:${providerId}` | `cache` | 900s (15m) | `1` | Đánh dấu model provider bị tạm ngắt do cạn quota/lỗi mạng |
| `errors:provider:${providerId}` | `cache` | 3600s (1h) | `{ count: number }` | Đếm số lỗi liên tiếp của provider phục vụ tự động failover |
| `lock:conversation:${conversationId}` | `cache` | 30s | `agentId / 'AI'` | Distributed lock chống double-texting khi AI Agent xử lý |
| `buffer:conversation:${conversationId}` | `cache` | 5s | Redis List `[message, ...]` | Bộ đệm tin nhắn khách hàng gửi liên tiếp trước khi debounce |

### 2.3. Module Inbox

| Key Pattern | Instance | TTL | Giá trị lưu | Mô tả |
|---|---|---|---|---|
| `lock:typing:conversation:${conversationId}` | `cache` | 5s | `${agentId}` | Typing indicator — "Đang soạn tin..." chống đụng độ |

### 2.4. Module CRM

| Key Pattern | Instance | TTL | Giá trị lưu | Mô tả |
|---|---|---|---|---|
| `lock:merge:phone:${phoneNumber}` | `cache` | 10s | `${requestId}` | Distributed lock chống race condition khi merge profile trùng SĐT |

### 2.5. Module Booking

| Key Pattern | Instance | TTL | Giá trị lưu | Mô tả |
|---|---|---|---|---|
| `lock:booking:slot:${hostId}:${slotKey}` | `cache` | 30s | `${requestId}` | Lock slot thời gian khi đang tạo lịch hẹn (chống double-booking) |
| `booking:round_robin:${eventTypeId}` | `cache` | no expiry | `${lastHostIndex}` | Counter Round-Robin phân phối lịch hẹn |

### 2.6. Module BullMQ Queues (redis-queue)

BullMQ tự quản lý key pattern riêng. Không can thiệp thủ công.

| Queue Name | Mô tả |
|---|---|
| `solavie:chat-processing` | Xử lý tin nhắn AI (Chatbot Orchestrator) |
| `solavie:chatbot-debounce` | Debounce tin nhắn gửi dồn dập (Gộp tin 3s) |
| `solavie:chatbot-followup` | Hàng đợi gửi tin nhắn chăm sóc nhắc nhở sau 15-30 phút |
| `solavie:chatbot-sequence` | Thực thi trì hoãn các bước trong chuỗi chăm sóc |
| `solavie:facebook-broadcast` | Hàng đợi xử lý gửi chiến dịch hàng loạt qua FB Messenger |
| `solavie:zalo-broadcast` | Hàng đợi xử lý gửi chiến dịch hàng loạt qua Zalo OA |
| `solavie:notification-email` | Hàng đợi gửi Email (AWS SES) |
| `solavie:notification-zalo` | Hàng đợi gửi Zalo ZNS |
| `solavie:webhook-outbox` | Retry webhook đến Facebook/Zalo |
| `solavie:storage-gc` | Garbage collector file rác MinIO |

---

## 3. Nguyên Tắc Naming

```
{module_prefix}:{entity}:{identifier_type}:{identifier_value}

Ví dụ:
  iam:refresh_token:${token}
  iam:activation:hash:${sha256}
  user:permissions:${userId}
  lock:typing:conversation:${id}
  lock:merge:phone:${phone}
```

### Quy tắc:
1. Luôn dùng **dấu hai chấm** (`:`) làm separator
2. Phần đầu là **module prefix** hoặc **domain** (iam, gw, lock, queue, user)
3. Identifier cuối cùng là **giá trị thực** (UUID, hash, phone...)
4. Keys chứa thông tin nhạy cảm phải **HASH** trước khi dùng làm key (như activation token)

---

## 4. Cleanup & Expiry Policy

| Loại Key | Policy |
|---|---|
| Keys có TTL | Tự động xóa khi hết hạn |
| Activation token | Xóa ngay lập tức sau khi dùng (single-use) |
| Refresh token | Xóa khi logout, đổi mật khẩu, hoặc rotation |
| Permission cache | Xóa khi Admin thay đổi Role/Permission |
| Brute-force counter | Tự expire sau 5 phút |
| Round-Robin counter | Không expire (persistent state) |

---

## 5. Monitoring & Alerts

Cần thiết lập Grafana alerts nếu:
- `redis-queue` sử dụng > 80% maxmemory (1GB) → Alert ngay
- `redis-cache` bị OOM errors → Alert ngay (thường do misconfiguration)
- Key `lock:conversation:*` tồn tại > 60 giây → Cảnh báo (có thể deadlock)
