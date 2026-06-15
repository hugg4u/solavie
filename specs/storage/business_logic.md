# Đặc Tả Business Logic Module Storage

## 1. Luồng Pre-signed Upload 
1. **Client** (Browser) gửi request xin URL upload: `POST /api/v1/storage/presigned-upload` kèm metadata (tên file, dung lượng, định dạng).
2. **Backend (Storage Service)**:
   - Validate định dạng (Chặn `.exe`, `.bat`, `.sh`...).
   - Validate dung lượng (VD: Giới hạn 50MB).
   - Generate `object_key` độc nhất (Tránh trùng tên) theo format: `{folder}/{YYYY}/{MM}/{DD}/{uuid}-{original_name}`.
   - Gọi lên MinIO tạo Pre-signed URL (Thường có thời hạn 15 phút).
   - Insert bản ghi vào bảng `storage_files` với trạng thái `is_confirmed = false`.
   - Trả về Pre-signed URL và `file_id` cho Client.
3. **Client** sử dụng HTTP PUT gửi file data trực tiếp tới Pre-signed URL của MinIO.
4. **Client** sau khi nhận HTTP 200 từ MinIO, gọi lại `POST /api/v1/storage/confirm` báo cho Backend cập nhật `is_confirmed = true`.

## 2. Luồng Pre-signed Download
1. **Client** cần hiển thị một file Private (Ví dụ hình ảnh HD). Client gọi `GET /api/v1/storage/presigned-download/:id`.
2. **Backend**:
   - Kiểm tra xem Client (User) có quyền xem file này không.
   - Nếu có quyền, gọi MinIO sinh ra Pre-signed URL dành riêng cho hàm GET (Thời hạn 5-10 phút).
   - Trả URL về cho Client để hiển thị thẻ `<img src="...">` hoặc tải file.

## 3. Cronjob Dọn Dẹp (Garbage Collection)
- Mỗi ngày 1 lần vào lúc 2:00 AM, Job Scheduler sẽ chạy.
- Quét bảng `storage_files` tìm các bản ghi có `is_confirmed = false` VÀ `created_at` cách đây quá 24h.
- Xóa Object trên MinIO (dựa theo `bucket_name` và `object_key`).
- Xóa bản ghi trong Database.
