# Quy Chuẩn Ghi Log Module Gateway

Tất cả log từ Module Gateway bắt buộc phải được ghi ở định dạng JSON có cấu trúc (stdout) để Promtail có thể thu thập và chuyển tiếp tới Grafana Loki.

---

## 1. Mẫu Log Nhận HTTP Request Webhook (Webhook Incoming Request)
Ghi log mỗi khi nhận được tin nhắn/webhook từ các kênh liên kết (Facebook, Zalo). Trình duyệt/tầng gateway sẽ gán hoặc sinh mới `traceId` để bắt đầu chuỗi liên vết.

```json
{
  "timestamp": "2026-06-15T16:20:00.100Z",
  "level": "info",
  "module": "GATEWAY",
  "context": "WEBHOOK_CONTROLLER",
  "message": "Incoming Webhook Request received",
  "traceId": "t_gate_110293_trace",
  "metadata": {
    "channel": "FACEBOOK",
    "sender_id": "psid_8829102",
    "http_method": "POST",
    "ip_address": "66.220.144.1"
  }
}
```

---

## 2. Mẫu Log Xác Thực Chữ Ký Thất Bại (Signature Verification Failed)
Ghi log cảnh báo khi chữ ký webhook không khớp, báo hiệu nguy cơ bị tấn công giả mạo yêu cầu (Jailbreak/DDoS attempts).

```json
{
  "timestamp": "2026-06-15T16:20:01.250Z",
  "level": "warn",
  "module": "GATEWAY",
  "context": "SIGNATURE_VALIDATOR",
  "message": "Webhook signature verification failed",
  "traceId": "t_gate_110294_trace",
  "metadata": {
    "channel": "ZALO",
    "received_signature": "zalo-sha256-signature-raw",
    "calculated_signature": "expected-sha256-signature",
    "ip_address": "120.72.100.5"
  }
}
```

---

## 3. Mẫu Log Giám Sát Hàng Đợi (Queue Size Monitoring)
Ghi log định kỳ thông số độ dài hàng đợi (Queue Size) của RabbitMQ/BullMQ để phục vụ vẽ biểu đồ giám sát.

```json
{
  "timestamp": "2026-06-15T16:25:00.000Z",
  "level": "info",
  "module": "GATEWAY",
  "context": "QUEUE_MONITOR_JOB",
  "message": "Queue size check metrics",
  "traceId": "job_queue_check_20260615",
  "metadata": {
    "queue_name": "chatbot-debounce",
    "active_jobs": 12,
    "delayed_jobs": 4,
    "failed_jobs": 0
  }
}
```

---

## 4. Mẫu Log Cảnh Báo Quá Tải Hàng Đợi (Queue Size Alert)
Ghi log cảnh báo mức độ nghiêm trọng khi hàng đợi bị dồn ứ tin nhắn vượt quá ngưỡng chịu tải an toàn (ví dụ: > 10,000 tin).

```json
{
  "timestamp": "2026-06-15T16:25:05.000Z",
  "level": "error",
  "module": "GATEWAY",
  "context": "QUEUE_MONITOR_JOB",
  "message": "Queue size has exceeded the safe threshold of 10,000 messages",
  "traceId": "job_queue_check_20260615",
  "metadata": {
    "queue_name": "chatbot-debounce",
    "current_size": 10542,
    "safe_threshold": 10000,
    "action_required": "Scale up consumers or check worker health"
  }
}
```

---

## 5. Mẫu Log Job Thất Bại Liên Tục (Dead Letter Queue Alert)
Ghi log mức độ khẩn cấp (critical) khi một message/job bị lỗi xử lý liên tiếp và chuyển vào Dead Letter Queue.

```json
{
  "timestamp": "2026-06-15T16:25:10.500Z",
  "level": "critical",
  "module": "GATEWAY",
  "context": "DEAD_LETTER_QUEUE",
  "message": "Job failed permanently and moved to DLQ",
  "traceId": "t_gate_110293_trace",
  "metadata": {
    "queue_name": "chatbot-debounce",
    "job_id": "debounce:conv_uuid_9921",
    "attempts_made": 3,
    "error_class": "AxiosError",
    "error_message": "Network timeout calling chatbot service adapter"
  }
}
```

---

## 6. Mẫu Log Quy Trình Transactional Outbox (Transactional Outbox Audit)

### 2.1. Log Lưu Sự Kiện Outbox Thành Công (Outbox Event Created - PENDING)
Ghi log mức `debug` hoặc `info` khi nhận webhook và ghi nhận tạm thời vào Database.
```json
{
  "timestamp": "2026-06-15T16:20:00.105Z",
  "level": "info",
  "module": "GATEWAY",
  "context": "OUTBOX_SERVICE",
  "message": "Outbox event registered in PENDING status",
  "traceId": "t_gate_110293_trace",
  "metadata": {
    "event_id": "evt_uuid_881920",
    "channel": "FACEBOOK",
    "status": "PENDING"
  }
}
```

### 2.2. Log Đẩy Lên Queue Thành Công (Outbox Event Dispatched - PROCESSED)
Ghi log khi đẩy thành công sự kiện từ Outbox vào BullMQ và cập nhật trạng thái trong database.
```json
{
  "timestamp": "2026-06-15T16:20:00.115Z",
  "level": "info",
  "module": "GATEWAY",
  "context": "OUTBOX_SERVICE",
  "message": "Outbox event processed and dispatched to queue",
  "traceId": "t_gate_110293_trace",
  "metadata": {
    "event_id": "evt_uuid_881920",
    "queue_name": "msg_queue",
    "status": "PROCESSED",
    "latency_ms": 10
  }
}
```

### 2.3. Log Worker Khôi Phục Outbox Quét Định Kỳ (Outbox Recovery Summary)
Ghi log thống kê mỗi khi background worker quét các tin nhắn bị kẹt.
```json
{
  "timestamp": "2026-06-15T16:20:30.000Z",
  "level": "info",
  "module": "GATEWAY",
  "context": "OUTBOX_RECOVERY_WORKER",
  "message": "Outbox recovery worker cycle completed",
  "traceId": "job_outbox_recover_20260615",
  "metadata": {
    "scanned_pending_count": 2,
    "recovered_successfully": 1,
    "failed_retry_incremented": 1,
    "permanently_failed": 0
  }
}
```

---

## 7. Mẫu Log Cơ Chế Mã Hóa AES-256-GCM (Crypto Audit Logs)

### 7.1. Log Mã Hóa Thành Công (Encryption Success)
Ghi log khi mã hóa thông tin credentials nhạy cảm trước khi ghi nhận xuống database.
```json
{
  "timestamp": "2026-06-15T16:21:00.005Z",
  "level": "info",
  "module": "GATEWAY",
  "context": "CRYPTO_SERVICE",
  "message": "Sensitive credentials encrypted successfully",
  "traceId": "t_gate_110295_trace",
  "metadata": {
    "channel_id": "cfg_uuid_5521",
    "algorithm": "aes-256-gcm",
    "iv_length": 12,
    "tag_length": 16
  }
}
```

### 7.2. Log Lỗi Giải Mã Thất Bại (Decryption Failure - Integrity Violation)
Ghi log cảnh báo nghiêm trọng khi giải mã thất bại (có thể do sai khóa SYSTEM_ENCRYPTION_KEY hoặc dữ liệu bị giả mạo vi phạm Auth Tag).
```json
{
  "timestamp": "2026-06-15T16:21:05.100Z",
  "level": "error",
  "module": "GATEWAY",
  "context": "CRYPTO_SERVICE",
  "message": "Decryption failed. Integrity check failed or invalid key.",
  "traceId": "t_gate_110296_trace",
  "metadata": {
    "channel_id": "cfg_uuid_5521",
    "error_message": "Unsupported state or unable to authenticate data",
    "action_required": "Check system environment variables and integrity of database encryption_tag"
  }
}
```

