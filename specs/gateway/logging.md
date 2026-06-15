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
