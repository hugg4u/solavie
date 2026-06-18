# Logging & Monitoring — Module DevOps (Tầng Hệ Thống)

Tài liệu này đặc tả quy chuẩn thiết lập và luồng lưu chuyển Log toàn hệ thống Solavie, sử dụng bộ công cụ giám sát tập trung **Grafana Loki, Promtail** và **Winston (Node.js)**.

---

## 1. Kiến Trúc Luồng Log (Logging Pipeline)

Hệ thống tuân thủ kiến trúc **Log Aggregation** chuyên nghiệp dành cho Microservices / Docker Container:

1. **Application Layer (Node.js/NestJS):** Các module sử dụng thư viện `Winston` xuất toàn bộ log dưới định dạng **Structured JSON** ra `stdout` (Console) của container. Không tự ý ghi log vào file từ bên trong Node.js để tránh tắc nghẽn I/O.
2. **Container Engine (Docker/K8s):** Docker Daemon thu thập log `stdout` và lưu thành file JSON ở mức Host OS (JSON File Logging Driver mặc định).
3. **Log Collector (Promtail):** Agent Promtail chạy dưới dạng một container độc lập, được mount Volume vào thư mục log của Docker trên máy chủ Host. Promtail sẽ đọc liên tục các file log này, phân tích cú pháp, trích xuất các trường quan trọng (Label) và đẩy lên Loki.
4. **Log Storage & Engine (Grafana Loki):** Loki đóng vai trò cơ sở dữ liệu chuỗi thời gian (Time-series DB) cho Log. Điểm đặc biệt của Loki là nó chỉ Index các Label (như `app`, `level`, `env`) thay vì Index toàn bộ text log, giúp tiết kiệm bộ nhớ và tối ưu chi phí cực lớn.
5. **Visualization (Grafana):** Kỹ sư dùng Grafana Dashboard viết truy vấn LogQL để vẽ biểu đồ và tìm kiếm lỗi.

---

## 2. Quy Chuẩn Ghi Log Bắt Buộc Tại Các Module

### 2.1. Định dạng JSON Chuẩn (Standard JSON Format)
Tất cả các dòng log in ra `stdout` BẮT BUỘC phải là JSON chứa tối thiểu các trường sau:

```json
{
  "timestamp": "2026-06-18T14:30:00.000Z",
  "level": "info",
  "service": "booking-service",
  "traceId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "actorId": "123e4567-e89b-12d3-a456-426614174000",
  "action": "GOOGLE_CALENDAR_WEBHOOK_RECEIVED",
  "message": "Received push notification from Google Calendar",
  "metadata": {
    "channelId": "solavie-watch-123",
    "resourceState": "exists"
  }
}
```

### 2.2. Quy Định Về Mức Độ (Log Level)
- `ERROR`: Lỗi hệ thống, Exception chưa catch được, DB kết nối lỗi, Call API hãng thứ 3 thất bại (có thể gửi Alert tới Telegram/Slack).
- `WARN`: Cảnh báo rủi ro (VD: API Key sắp hết hạn, Rate Limit sắp đạt đỉnh, Retries sự kiện quá 3 lần).
- `INFO`: Các sự kiện nghiệp vụ quan trọng (VD: `LEAD_CREATED`, `PAYMENT_SUCCESS`, `MESSAGE_SENT`).
- `DEBUG`: Dùng để in payload HTTP Request/Response, chi tiết hàm xử lý (Chỉ bật khi dev hoặc fix bug).

---

## 3. Cấu Hình Tầng Thu Thập (Promtail Configuration)

Cấu hình mẫu `promtail-config.yml` dùng để bóc tách thông tin từ Docker JSON driver và chuyển thành Loki Labels:

```yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: system
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 5s
    relabel_configs:
      - source_labels: ['__meta_docker_container_name']
        regex: '/(.*)'
        target_label: 'container_name'
    pipeline_stages:
      # Cắt bỏ chuẩn của Docker driver để lấy trực tiếp log message
      - docker: {}
      # Do app log ra JSON, ta phân tích JSON luôn
      - json:
          expressions:
            service: service
            level: level
            traceId: traceId
            action: action
      # Thăng cấp các key này thành Label cho Loki để Index search nhanh
      - labels:
          service:
          level:
          action:
```

---

## 4. Quản Lý Log Thông Minh (Log Retention)

Do hệ thống sinh log liên tục, Loki sẽ được cấu hình **Retention Policy = 30 Ngày**. Sau 30 ngày log sẽ bị tự động xóa để giải phóng dung lượng đĩa. 
Nếu hệ thống cần log Audit lưu dài hạn phục vụ truy vết pháp lý (Legal Compliance), dữ liệu đó đã nằm ở bảng `crm_audit_logs` hoặc `iam_role_audit_logs` lưu vĩnh viễn trong CSDL PostgreSQL.
