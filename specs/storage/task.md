# Task Lập Trình Module Storage

- `[ ]` **Docker Setup:** Thêm file `docker-compose.yml` để setup dịch vụ MinIO server nội bộ (cùng mạng với Backend).
- `[ ]` **Storage Service:** Cài đặt package `@aws-sdk/client-s3` và `@aws-sdk/s3-request-presigner`. Viết wrapper kết nối S3 API.
- `[ ]` **Bucket Provisioning Script:** Viết script tự động tạo 3 buckets `rag-documents`, `customer-media`, `system-assets` khi hệ thống lần đầu khởi chạy.
- `[ ]` **Pre-signed APIs:** Implement API Endpoint cấp URL Upload và Download.
- `[ ]` **Cronjob GC:** Tích hợp bộ lập lịch (vd `@nestjs/schedule`) để viết Job dọn dẹp file rác `is_confirmed = false` hàng ngày.
