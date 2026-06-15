# Yêu Cầu Chức Năng Module Storage (Requirements)

## 1. Giới thiệu Module
Module Storage quản lý toàn bộ vòng đời của các file tĩnh (Media, Documents) trong hệ thống Solavie, sử dụng kiến trúc Object Storage (MinIO) tương thích với Amazon S3 API. 

## 2. Yêu cầu nghiệp vụ

### 2.1. Upload trực tiếp từ Client (Pre-signed URL)
- Hệ thống backend không tiếp nhận luồng byte trực tiếp của file để tránh quá tải RAM và băng thông.
- Backend chỉ chịu trách nhiệm sinh URL cấp quyền tạm thời (Pre-signed URL) cho phép người dùng hoặc Admin upload file trực tiếp lên MinIO.

### 2.2. Phân vùng dữ liệu (Buckets)
- Dữ liệu phải được phân tách theo mức độ bảo mật thông qua cấu hình Buckets.
- Các file công khai (VD: Logo, icon) được đưa vào Public Bucket.
- Các file nội bộ và nhạy cảm (VD: Hợp đồng, tài liệu nội bộ RAG) được đưa vào Private Bucket.

### 2.3. Quản lý trạng thái File rác (Orphan Files)
- Trong trường hợp Client đã upload file lên MinIO nhưng rớt mạng trước khi báo cáo thành công về cho Backend (Confirm).
- Hệ thống cần có cơ chế dọn dẹp các file rác này sau một khoảng thời gian nhất định (Ví dụ: 24h) để tiết kiệm dung lượng lưu trữ.

### 2.4. Trình phân phối (CDN & Caching)
- File sau khi upload có thể được trích xuất bằng link truy cập tạm thời (Signed URL) hoặc thông qua hệ thống CDN/Cache (Nếu triển khai Phase sau).
