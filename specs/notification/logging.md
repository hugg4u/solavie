# Logging & Monitoring — Module Notification

## 1. Cấu Trúc Log Chuẩn (Structured JSON Logging)

Tuân thủ chuẩn Structured Logging JSON của toàn hệ thống Solavie (sử dụng Pino logger).

### 1.1. Log khi Event được nhận
```json
{
  "timestamp": "2026-06-16T10:00:00.000Z",
  "level": "info",
  "module": "Notification",
  "context": "NotificationService",
  "message": "Event received, processing notification",
  "traceId": "req_trace_uuid",
  "metadata": {
    "event_type": "appointment.confirmed",
    "entity_id": "appointment-uuid-123",
    "recipient_count": 3
  }
}
```

### 1.2. Log khi Notification được gửi thành công
```json
{
  "timestamp": "2026-06-16T10:00:00.500Z",
  "level": "info",
  "module": "Notification",
  "context": "EmailWorker",
  "message": "Notification sent successfully",
  "traceId": "req_trace_uuid",
  "metadata": {
    "idempotency_key": "sha256_hash_value",
    "event_type": "appointment.confirmed",
    "channel": "email",
    "recipient_contact": "customer@example.com",
    "provider_message_id": "ses-msg-id-abc",
    "duration_ms": 312
  }
}
```

### 1.3. Log khi Notification bị Skip
```json
{
  "timestamp": "2026-06-16T10:00:00.100Z",
  "level": "warn",
  "module": "Notification",
  "context": "NotificationRouter",
  "message": "Notification skipped",
  "traceId": "req_trace_uuid",
  "metadata": {
    "idempotency_key": "sha256_hash_value",
    "event_type": "lead.assigned",
    "channel": "email",
    "recipient_id": "sales-uuid",
    "skip_reason": "QUIET_HOURS"
  }
}
```

### 1.4. Log khi Notification thất bại
```json
{
  "timestamp": "2026-06-16T10:00:01.200Z",
  "level": "error",
  "module": "Notification",
  "context": "ZaloWorker",
  "message": "Notification delivery failed",
  "traceId": "req_trace_uuid",
  "metadata": {
    "idempotency_key": "sha256_hash_value",
    "event_type": "appointment.confirmed",
    "channel": "zalo",
    "recipient_contact": "0901234567",
    "retry_count": 2,
    "error": "Zalo ZNS API error: TEMPLATE_NOT_APPROVED",
    "will_retry": true
  }
}
```

### 1.5. Log khi Job vào Dead-Letter Queue
```json
{
  "timestamp": "2026-06-16T10:00:10.000Z",
  "level": "error",
  "module": "Notification",
  "context": "EmailWorker",
  "message": "Notification moved to Dead-Letter Queue after max retries",
  "traceId": "req_trace_uuid",
  "metadata": {
    "idempotency_key": "sha256_hash_value",
    "event_type": "appointment.reminder_24h",
    "channel": "email",
    "retry_count": 3,
    "final_error": "SMTP connection timeout"
  }
}
```

---

## 2. Labels cho Promtail/Loki

Các trường sau phải được trích xuất làm labels để hỗ trợ LogQL query:
- `module`: "Notification"
- `context`: Tên class/worker (EmailWorker, ZaloWorker, NotificationService...)
- `level`: info | warn | error
- `event_type`: Loại sự kiện (để filter theo business domain)
- `channel`: email | zalo | in_app

---

## 3. Cảnh Báo Grafana (Alert Rules)

| Tên Rule | Điều kiện kích hoạt | Hành động |
|---------|--------------------|-----------| 
| **HIGH_FAILURE_RATE** | `count(level="error", module="Notification") > 10` trong 5 phút | Alert Telegram/Discord cho DevOps |
| **DLQ_JOB_DETECTED** | Bất kỳ log nào có message "moved to Dead-Letter Queue" | Alert ngay lập tức |
| **ZALO_API_DEGRADED** | `count(channel="zalo", level="error") > 5` trong 10 phút | Alert DevOps để kiểm tra Zalo API |
| **EMAIL_DELIVERY_SLOW** | `avg(duration_ms) > 5000` trong 5 phút | Alert cho review SES quota |

---

## 4. Metrics Cần Expose (Prometheus)

```
# Tổng số thông báo theo trạng thái
notification_total{status="SENT", channel="email"} 
notification_total{status="FAILED", channel="zalo"}
notification_total{status="SKIPPED", skip_reason="QUIET_HOURS"}

# Thời gian xử lý trung bình
notification_duration_ms{channel="email", quantile="0.95"}
notification_duration_ms{channel="zalo", quantile="0.95"}
notification_duration_ms{channel="in_app", quantile="0.95"}

# Số job trong queue
notification_queue_size{queue="email-notification-queue"}
notification_queue_size{queue="zalo-notification-queue"}
notification_queue_size{queue="scheduled-notification-queue"}
notification_queue_size{queue="dead-letter-queue"}
```
