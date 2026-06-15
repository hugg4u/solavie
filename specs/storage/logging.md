# Quy Chuẩn Ghi Log Module Storage

Tất cả các log ghi vết nghiệp vụ lưu trữ và giám sát hạ tầng lưu trữ của Module Storage bắt buộc phải in ra stdout dưới dạng JSON có cấu trúc.

---

## 1. Mẫu Log Tải Lên Tập Tin Thành Công (File Uploaded Success)
Ghi log mức `info` khi một file ảnh hoặc tài liệu được upload lên Cloud Storage (MinIO/S3) và được confirm lưu trữ thành công.

```json
{
  "timestamp": "2026-06-15T16:50:00.123Z",
  "level": "info",
  "module": "STORAGE",
  "context": "STORAGE_SERVICE",
  "message": "File uploaded and confirmed successfully",
  "traceId": "t_stor_772102_trace",
  "metadata": {
    "file_id": "file_uuid_55921",
    "bucket": "solavie-leads-assets",
    "file_name": "lead_roof_photo.jpg",
    "file_size_bytes": 2048500,
    "uploaded_by": "usr_sales_uuid_445"
  }
}
```

---

## 2. Mẫu Log Xóa Tập Tin (File Deleted Security Audit)
Ghi log cảnh báo mức `warn` khi một file bị xóa vĩnh viễn khỏi bucket để phục vụ rà soát an ninh dữ liệu.

```json
{
  "timestamp": "2026-06-15T16:51:05.456Z",
  "level": "warn",
  "module": "STORAGE",
  "context": "STORAGE_SERVICE",
  "message": "File deleted permanently from storage",
  "traceId": "t_stor_772103_trace",
  "metadata": {
    "file_id": "file_uuid_55921",
    "bucket": "solavie-leads-assets",
    "file_name": "lead_roof_photo.jpg",
    "deleted_by": "usr_admin_uuid_112"
  }
}
```

---

## 3. Mẫu Log Lỗi Kết Nối MinIO/S3 API (Cloud Storage Connection Error)
Ghi log lỗi mức `error` khi backend thất bại trong việc thực hiện request gọi tới AWS S3/MinIO API do lỗi mạng hoặc cấu hình.

```json
{
  "timestamp": "2026-06-15T16:52:10.789Z",
  "level": "error",
  "module": "STORAGE",
  "context": "MINIO_ADAPTER",
  "message": "Failed to connect to Cloud Storage API",
  "traceId": "t_stor_772104_trace",
  "metadata": {
    "operation": "PUT_OBJECT",
    "endpoint": "https://minio.solavie.internal:9000",
    "error_code": "RequestTimeout",
    "error_message": "Connection timed out after 5000ms"
  }
}
```

---

## 4. Mẫu Log Quá Tải Dung Lượng Lưu Trữ (Disk Quota Exceeded Alert)
Ghi log cảnh báo khẩn cấp mức `critical` khi tổng dung lượng sử dụng của phân vùng đĩa cứng lưu trữ đạt trên 80% quota quy định.

```json
{
  "timestamp": "2026-06-15T16:55:00.000Z",
  "level": "critical",
  "module": "STORAGE",
  "context": "DISK_USAGE_MONITOR",
  "message": "Storage disk usage has exceeded 80% quota threshold",
  "traceId": "job_disk_check_20260615",
  "metadata": {
    "total_size_bytes": 1099511627776,
    "used_size_bytes": 890581052620,
    "usage_percentage": 81.0,
    "action_required": "Please expand storage partition immediately or clean up old assets"
  }
}
```
