# Thiết Kế Kiến Trúc Module Storage (Design)

## 1. Kiến Trúc Storage
- **Core Engine:** MinIO (Chạy qua Docker).
- **SDK Tích hợp:** Sử dụng thư viện `@aws-sdk/client-s3` và `@aws-sdk/s3-request-presigner` của hệ sinh thái Node.js (tương thích ngược hoàn toàn với MinIO).
- **Quy hoạch Buckets:**
  - `rag-documents` (Private): Chứa tài liệu dạng PDF/Word để RAG Engine đọc và embedding.
  - `customer-media` (Private): Hình ảnh khảo sát mái nhà, hợp đồng, giấy tờ tùy thân của khách hàng.
  - `user-media` (Public): Chứa ảnh đại diện (Avatar) của nhân viên (iam_users) hoặc khách hàng để load nhanh trên UI.
  - `system-assets` (Public): Các file tĩnh dùng chung như logo công ty, banner hệ thống.

## 2. Thiết Kế Database (Lược Đồ Quan Hệ)

### Bảng `storage_files`
Lưu trữ metadata để hệ thống Solavie biết file đó đang nằm ở đâu trên MinIO.

| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | Định danh file trong DB nội bộ |
| `bucket_name` | VARCHAR(50) | Tên bucket (VD: `rag-documents`) |
| `object_key` | VARCHAR(255) | Đường dẫn thực tế trên MinIO (VD: `customer-media/2026/06/15/abc-123.jpg`) |
| `original_name`| VARCHAR(255) | Tên gốc lúc upload (`hop-dong.pdf`) |
| `mime_type` | VARCHAR(100) | Định dạng (VD: `application/pdf`) |
| `size_bytes` | INTEGER | Dung lượng (Byte) |
| `uploader_id` | UUID | ID của user tải lên (Có thể null) |
| `is_confirmed`| BOOLEAN | Cờ đánh dấu Client đã submit form và lưu file này thành công |

## 3. Thiết Kế API Endpoints

- `POST /api/v1/storage/presigned-upload`: Lấy URL upload tạm thời.
- `POST /api/v1/storage/confirm`: Xác nhận file đã upload xong để cập nhật `is_confirmed = true`.
- `GET /api/v1/storage/presigned-download/:id`: Lấy URL download (có thời hạn) của một file Private.
- `DELETE /api/v1/storage/files/:id`: Xóa file khỏi MinIO và Database.
