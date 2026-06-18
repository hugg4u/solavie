# Task Lập Trình & Triển Khai Hạ Tầng DevOps (Docker)

Kế hoạch xây dựng hạ tầng container hóa và triển khai hệ thống Solavie Platform được phân chia thành các task cụ thể sau:

## Phase 1: Dockerfile & Base Setup
- [ ] **Multi-stage Dockerfile:** Viết tệp `Dockerfile` đa tầng cho NestJS backend (Stage 1: Build & Compile TypeScript; Stage 2: Production release sử dụng base image Node-Alpine).
- [ ] **Docker Ignore Setup:** Cấu hình tệp `.dockerignore` để loại bỏ `node_modules`, `dist`, và logs khỏi quá trình copy build.
- [ ] **Environment Example Setup:** Soạn thảo tệp `.env.example` liệt kê đầy đủ các biến môi trường cấu hình (DB, Redis cache, Redis queue, MinIO, LiteLLM, JWT, Encryption keys).

## Phase 2: Docker Compose Orchestration
- [ ] **Database Container Setup:** Cấu hình service `postgres` trong `docker-compose.yml` sử dụng image `ankane/pgvector:v0.5.1` để hỗ trợ Vector RAG.
- [ ] **Isolated Redis Provisioning:** Khai báo 2 container `redis-cache` (maxmemory-policy: `allkeys-lru`) và `redis-queue` (maxmemory-policy: `noeviction`, bật `appendonly yes`).
- [ ] **Object Storage Provisioning:** Cấu hình container `minio` với cổng API `9000` và cổng Console UI `9001`.
- [ ] **AI Gateway Provisioning:** Khai báo container `litellm` chạy proxy LiteLLM để chuyển tiếp request.
- [ ] **Health Checks Implementation:** Viết các lệnh kiểm tra sức khỏe (`healthcheck` qua curl/redis-cli/pg_isready) cho tất cả các container hạ tầng.
- [ ] **Depends_on Ordering:** Thiết lập ràng buộc khởi chạy `depends_on` với điều kiện `service_healthy` cho NestJS backend container.

## Phase 3: Post-Initialization & Persistence
- [ ] **Database Volume Persistence:** Cấu hình persistent volumes cho Postgres (`pg_data`) và MinIO (`minio_data`) để bảo vệ dữ liệu khi tắt container.
- [ ] **Redis Volume Persistence:** Cấu hình persistent volumes cho `redis_cache_data` và `redis_queue_data` để lưu trữ AOF log và cache.
- [ ] **MinIO Auto-Bucket Creation Script:** Viết tệp shell script hoặc tích hợp logic khởi chạy trong NestJS Backend để tự động kiểm tra và tạo 3 buckets: `rag-documents`, `customer-media`, `system-assets` khi hệ thống chạy lần đầu.

## Phase 4: Notification Module Environment Setup
- [ ] **Email SMTP/SES Env Vars:** Thêm đầy đủ biến môi trường Email vào `.env.example` và `docker-compose.yml`:
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (cho Development — dùng Mailhog/Mailtrap).
  - `AWS_SES_REGION`, `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY`, `SES_FROM_EMAIL` (cho Production).
  - `NOTIFICATION_FROM_EMAIL`, `NOTIFICATION_FROM_NAME`.
- [ ] **Zalo ZNS Env Vars:** Thêm `ZALO_OA_ID`, `ZALO_OA_ACCESS_TOKEN`, `ZALO_ZNS_SECRET_KEY` vào `.env.example` và `docker-compose.yml`.
- [ ] **Mailhog Dev Container (Tùy chọn):** Cân nhắc thêm container `mailhog` vào `docker-compose.yml` cho môi trường Development để test Email mà không cần kết nối SMTP thực.
- [ ] **Environment Variable Validation:** Thêm kiểm tra validation trong `app.module.ts` (hoặc `ConfigModule`) để throw lỗi rõ ràng khi thiếu biến môi trường bắt buộc của Notification Module.

## Phase 5: Security & Production Hardening
- [ ] **Non-Root User:** Đảm bảo Dockerfile Stage 2 sử dụng `USER node` (non-root) để chạy container Production.
- [ ] **Secret Management:** Tài liệu hóa quy trình đưa secrets vào container: tuyệt đối không hardcode, sử dụng `.env` file local (development) hoặc Docker Secrets / AWS Secrets Manager (production).
- [ ] **Image Size Audit:** Xác minh image NestJS Production < 150MB sau khi build hoàn chỉnh với tất cả modules mới (bao gồm Notification Module dependencies: `nodemailer`, `handlebars`, `bullmq`).
