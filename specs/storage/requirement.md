# Yêu Cầu Chức Năng Module Storage (Requirements)

## 1. Giới thiệu Module
Module Storage quản lý toàn bộ vòng đời của các file tĩnh (Media, Documents) trong hệ thống Solavie, sử dụng kiến trúc Object Storage (MinIO) tương thích với Amazon S3 API. 

## 2. Yêu cầu nghiệp vụ

### 2.1. Upload trực tiếp từ Client (Pre-signed POST)
- Hệ thống backend không tiếp nhận luồng byte trực tiếp của file để tránh quá tải RAM và băng thông.
- Backend chỉ chịu trách nhiệm sinh chính sách upload (Presigned POST Policy) cấp quyền tạm thời, đồng thời áp đặt các ràng buộc chặt chẽ (Constraints) về dung lượng (Content-Length-Range) và loại file (MIME-Type) để chặn đứng các cuộc tấn công tải lên mã độc. Client sử dụng policy này để upload trực tiếp lên MinIO.

### 2.2. Phân vùng dữ liệu (Buckets)
- Dữ liệu phải được phân tách theo mức độ bảo mật thông qua cấu hình Buckets.
- Các file công khai (VD: Logo, icon) được đưa vào Public Bucket.
- Các file nội bộ và nhạy cảm (VD: Hợp đồng, tài liệu nội bộ RAG) được đưa vào Private Bucket.

### 2.3. Quản lý trạng thái File rác (Orphan Files) bằng OLM
- Trong trường hợp Client đã upload file lên MinIO nhưng rớt mạng trước khi báo cáo thành công về cho Backend (Confirm).
- Hệ thống cần dọn dẹp các file rác này một cách tự động và ổn định nhất bằng cách cấu hình Object Lifecycle Management (OLM) của MinIO, thay vì tự viết các vòng lặp Cronjob quét database trên tầng Application (tránh quá tải Event Loop).

### 2.4. Trình phân phối (CDN & Caching)
- File sau khi upload có thể được trích xuất bằng link truy cập tạm thời (Signed URL) hoặc thông qua hệ thống CDN/Cache (Nếu triển khai Phase sau).

### 2.5. Tối Ưu Hóa Hình Ảnh (Async Image Processing)
- Các hình ảnh được upload lên (như Avatar, Ảnh dự án) phải được tự động xử lý bất đồng bộ (giảm dung lượng, chuyển đổi định dạng WebP) thông qua Background Worker nhằm tiết kiệm băng thông khi hiển thị trên Frontend.
