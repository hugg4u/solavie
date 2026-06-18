# Task Lập Trình Module Storage

- `[x]` **Docker Setup:** Cấu hình container MinIO (Đã gộp vào [task.md (DevOps)](file:///d:/workspace/project/solavie/specs/devops/task.md)).
- `[ ]` **Storage Entities & Outbox:** Cài đặt TypeORM Entity cho bảng `storage_files` và `storage_outbox_events` (hỗ trợ Transactional Outbox).
- `[ ]` **Storage Service:** Cài đặt package `@aws-sdk/client-s3` và `@aws-sdk/s3-presigned-post`. Viết wrapper kết nối S3 API.
- `[ ]` **Bucket Provisioning Script:** Viết script tự động tạo 4 buckets `rag-documents`, `customer-media`, `user-media`, `system-assets` khi hệ thống lần đầu khởi chạy, đồng thời gắn Lifecycle Policy (OLM) tự động xóa thư mục `tmp/` sau 1 ngày.
- `[ ]` **Presigned POST API (Idempotency):** Implement API Endpoint cấp chính sách upload `createPresignedPost` với các constraint bảo mật (Content-Length, Content-Type) và bắt buộc header `Idempotency-Key` (dùng Redis SET NX).
- `[ ]` **Confirm API (Idempotency & Outbox):** Implement API Confirm (có check `Idempotency-Key`), thực hiện lệnh `CopyObject` để move file ra khỏi thư mục `tmp/`. Ghi event `storage.file_uploaded` vào bảng `storage_outbox_events` trong cùng một DB Transaction.
- `[ ]` **Storage Outbox Processor & Sweeper:** Triển khai BullMQ Processor và Sweeper quét bảng `storage_outbox_events` bằng `SKIP LOCKED` định kỳ và publish lên Event Bus.
- `[ ]` **Presigned Download API (ABAC):** Implement `GET /api/v1/storage/presigned-download/:id` kết hợp với TypeORM QueryBuilder để filter quyền truy cập file (Chỉ owner hoặc Admin mới được tạo link tải).
- `[ ]` **Image Processing Worker:** Triển khai BullMQ Queue và Worker sử dụng thư viện `sharp` để nén ảnh sang định dạng WebP.
