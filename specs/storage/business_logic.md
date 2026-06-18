# Đặc Tả Business Logic Module Storage

## 1. Luồng Pre-signed Upload (POST Policy)
1. **Client** (Browser) gửi request xin policy upload: `POST /api/v1/storage/presigned-post` kèm metadata (tên file, dung lượng, định dạng).
2. **Backend (Storage Service)**:
   - Yêu cầu Header `Idempotency-Key` (để tránh double request).
   - Validate định dạng (Chỉ cho phép MIME type hợp lệ, vd: `image/jpeg`, `application/pdf`).
   - Validate dung lượng (VD: Giới hạn 50MB).
   - Generate `object_key` tạm thời theo format: `{folder}/tmp/{YYYY}/{MM}/{uuid}-{original_name}`. (Lưu ý thư mục `tmp/`).
   - Gọi lên MinIO tạo `Presigned POST Policy`. Policy này ép buộc (Constraints) dung lượng (`content-length-range`) và định dạng (`Content-Type`) phải khớp chính xác với thông số đã validate.
   - Insert bản ghi vào bảng `storage_files` với trạng thái `is_confirmed = false` và lưu `Idempotency-Key` vào cache để chặn gọi trùng.
   - Trả về `url`, `fields` (form data) và `file_id` cho Client.
3. **Client** sử dụng HTTP POST (FormData) đính kèm các `fields` và file data gửi trực tiếp tới URL của MinIO. Nếu bị hacker tráo đổi file dung lượng lớn hơn hoặc sai định dạng, MinIO sẽ từ chối.
4. **Client** sau khi nhận HTTP 204 từ MinIO, gọi lại `POST /api/v1/storage/confirm` báo cho Backend (yêu cầu header `Idempotency-Key`).
5. **Backend**:
   - Kiểm tra `Idempotency-Key`.
   - Gọi `CopyObject` chuyển file từ `tmp/...` sang vị trí chính thức (xóa chữ `tmp/`).
   - Cập nhật `is_confirmed = true`.
   - (Tùy chọn) Ghi sự kiện `storage.file_uploaded` vào bảng `storage_outbox_events` để Publish qua Event Bus cho các module khác.

## 2. Luồng Pre-signed Download & ABAC Filtering
1. **Client** cần hiển thị một file Private (Ví dụ hình ảnh HD). Client gọi `GET /api/v1/storage/presigned-download/:id`.
2. **Backend**:
   - Áp dụng ABAC Data Filtering thông qua TypeORM QueryBuilder: `query.where('file.id = :id').andWhere('file.created_by = :userId')` (nếu user không phải admin).
   - Nếu tìm thấy file, gọi MinIO sinh ra Pre-signed URL dành riêng cho hàm GET (Thời hạn 5-10 phút).
   - Trả URL về cho Client để hiển thị thẻ `<img src="...">` hoặc tải file.

## 3. Quản Lý File Rác (Orphan Files) Với MinIO OLM
Để dọn dẹp các file rác (Client xin link nhưng rớt mạng không upload hoặc upload xong không confirm), hệ thống cấu hình **Object Lifecycle Management (OLM)** trên MinIO.

1. **DevOps Setup:** Bucket trên MinIO được gắn một Lifecycle Rule: "Tất cả Object có prefix `tmp/` sẽ tự động bị xóa (Expiration) sau 1 ngày (24 hours)".
2. **Backend Logic:** Khi cấp link upload, Backend luôn luôn đưa file vào thư mục `tmp/` của bucket đó.
3. **Confirm Logic:** Chỉ khi Backend nhận được tín hiệu Confirm từ Client, Backend mới di dời file ra khỏi thư mục `tmp/` thông qua lệnh `CopyObject`.
4. **Kết quả:** Mọi file chưa được confirm sẽ mặc nhiên "chết" trong `tmp/` sau 24h bởi engine của MinIO, Backend không cần tốn resource chạy Cronjob quét rác.

## 4. Xử Lý Ảnh Tự Động (Async Image Processing)
Để tăng tốc độ tải trang, hình ảnh (Avatar, Hình khảo sát) phải được nén và tối ưu hóa.

1. **Trigger:** Sau khi thực hiện luồng `POST /api/v1/storage/confirm` thành công đối với các file có `mime_type` là ảnh (`image/*`), Backend sẽ bắn một event hoặc đưa job vào Redis BullMQ với tên queue `image-processing-queue`.
2. **Worker xử lý:** Một worker độc lập (có thể là một module/process tách biệt) lấy job từ queue.
3. **Thao tác Sharp:** 
   - Tải file gốc từ MinIO về buffer RAM.
   - Dùng thư viện `sharp` để resize ảnh (nếu kích thước quá lớn, vd max-width 1920px) và convert sang định dạng `webp` (quality: 80).
4. **Cập nhật:**
   - Worker upload file `.webp` mới lên MinIO đè vào vị trí cũ (hoặc thay đổi extension).
   - Xóa file ảnh gốc trên MinIO nếu khác định dạng.
   - Cập nhật thông tin `size_bytes` và `mime_type` mới vào bảng `storage_files`.

