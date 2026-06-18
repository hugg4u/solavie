# Yêu Cầu Hạ Tầng & Triển Khai Docker (DevOps Requirements)

Tài liệu này xác định các yêu cầu kỹ thuật đối với hạ tầng container hóa và triển khai (DevOps) hệ thống Solavie Platform sử dụng Docker và Docker Compose cho môi trường phát triển (Development) và chạy thử (Staging).

---

## 1. Yêu Cầu Các Thành Phần Hạ Tầng (Infrastructure Components)

Hệ thống Solavie Platform được đóng gói thành các dịch vụ độc lập chạy trong cùng một mạng nội bộ ảo (Docker Network):

### 1.1. Cở sở dữ liệu chính (PostgreSQL + PgVector)
*   **Yêu cầu:** Kích hoạt extension `pgvector` phục vụ lưu trữ embeddings của chatbot.
*   **Dung lượng & Phục hồi:** Thiết lập persistent volume để lưu trữ dữ liệu bền vững, tránh mất mát dữ liệu khi container khởi động lại.

### 1.2. Hạ tầng Bộ đệm & Hàng đợi (Redis Isolation)
*   **Yêu cầu:** Cô lập vật lý thành 2 instance Redis độc lập:
    *   `redis-cache`: Dành cho lưu trữ cache, session và typing lock (maxmemory-policy: `allkeys-lru`).
    *   `redis-queue`: Dành cho hàng đợi tin nhắn BullMQ (maxmemory-policy: `noeviction`, bật ghi log AOF).

### 1.3. Object Storage (MinIO)
*   **Yêu cầu:** Chạy server MinIO tương thích S3 API. Cấu hình tự động khởi tạo các bucket cần thiết (`rag-documents`, `customer-media`, `system-assets`) ở lần đầu khởi chạy.
*   **Bảo mật:** Cô lập cổng quản trị Console (giao diện UI) và cổng API kết nối của backend.

### 1.4. AI Gateway (LiteLLM Proxy)
*   **Yêu cầu:** Chạy proxy LiteLLM để chuyển tiếp và định tuyến các request đến OpenAI, Gemini, Anthropic.
*   **Tính liên tục:** Kết nối qua mạng Docker nội bộ với backend NestJS để loại bỏ overhead mạng.

### 1.5. NestJS Application Service
*   **Yêu cầu:** Đóng gói mã nguồn NestJS sử dụng Multi-stage Dockerfile để giảm dung lượng image và tăng độ bảo mật ở môi trường Production.

### 1.6. Tích hợp Google Calendar API Credentials
*   **Yêu cầu:** Khai báo và truyền đầy đủ các tham số cấu hình OAuth2 (Client ID, Client Secret, Redirect URI) cho Google Calendar API vào container Backend dưới dạng biến môi trường để phục vụ tính năng lọc lịch bận của nhân viên Sales.

### 1.7. Notification Module Credentials (Email + Zalo ZNS)
*   **Yêu cầu:** Cung cấp đủ biến môi trường cho cả 2 kênh thông báo bên ngoài.
*   **Email (AWS SES/SMTP):**
    *   `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — Cấu hình SMTP cho môi trường Development/Staging (có thể dùng Mailtrap hoặc Mailhog).
    *   `AWS_SES_REGION`, `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY`, `SES_FROM_EMAIL` — Cấu hình AWS SES cho môi trường Production.
*   **Zalo OA ZNS:**
    *   `ZALO_OA_ID` — ID Official Account của Solavie trên Zalo.
    *   `ZALO_OA_ACCESS_TOKEN` — Token truy cập Zalo OA API.
    *   `ZALO_ZNS_SECRET_KEY` — Secret key để sign ZNS request.
*   **Email Sender:**
    *   `NOTIFICATION_FROM_EMAIL` — Email gửi đi (VD: `no-reply@solavie.vn`).
    *   `NOTIFICATION_FROM_NAME` — Tên người gửi (VD: `Solavie Solar Energy`).

---

## 2. Chỉ Số Hiệu Năng & Tiêu Chuẩn Bảo Mật (Non-Functional Requirements)

*   **Dung lượng Image Backend:** Image NestJS Production sau khi build phải **< 150MB** (sử dụng base image Node-Alpine và loại bỏ devDependencies).
*   **Security Scanning:** Đảm bảo base image của các container không chứa các lỗ hổng bảo mật nghiêm trọng (CVEs).
*   **Health Checks:** Tất cả các service hạ tầng (Postgres, Redis, MinIO) phải cấu hình cờ `healthcheck` để đảm bảo container Backend chỉ khởi chạy sau khi database và cache đã sẵn sàng nhận kết nối (`depends_on: ... condition: service_healthy`).
