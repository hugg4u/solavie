# Logging & Monitoring — Module Storage

Tài liệu này đặc tả quy chuẩn Structured Logging cho Module Storage (xử lý File Upload/Download với MinIO) theo chuẩn hệ thống chung sử dụng Grafana Loki.

---

## 1. Cấu Trúc Log Chuẩn (Structured JSON Logging)

Tuân thủ chuẩn Structured Logging JSON của toàn hệ thống Solavie. Mọi thao tác I/O với hệ thống Storage S3 (MinIO) đều được ghi nhận (Audit Trail).

**Mẫu Payload chuẩn:**
```json
{
  "timestamp": "2026-06-18T10:15:22.000Z",
  "level": "info",
  "service": "storage-module",
  "traceId": "req-123-abc",
  "actorId": "user-uuid-456",
  "action": "FILE_PRESIGNED_URL_GENERATED",
  "message": "Generated pre-signed URL for file upload",
  "metadata": {
    "bucket": "customer-media",
    "objectKey": "customer-media/2026/06/18/uuid.jpg",
    "mimeType": "image/jpeg",
    "expiresInSeconds": 3600
  }
}
```

---

## 2. Các Action Bắt Buộc Ghi Log (Log Events)

### 2.1. File Operations (Bảo mật truy cập)
| `action` (Chuẩn Hóa) | Mức Độ | Mô Tả Nghiệp Vụ | Dữ Liệu `metadata` Đặc Trưng |
| --- | --- | --- | --- |
| `FILE_PRESIGNED_URL_GENERATED` | `info` | Ghi nhận khi có yêu cầu sinh URL upload/download. | `bucket`, `objectKey`, `expiresInSeconds`, `urlType` (upload/download) |
| `FILE_UPLOAD_CONFIRMED` | `info` | Xác nhận file đã được upload lên MinIO thành công bởi Client. | `bucket`, `objectKey`, `sizeBytes`, `mimeType` |
| `FILE_DELETED` | `info` | Xóa cứng file khỏi MinIO. | `bucket`, `objectKey` |
| `FILE_ACCESS_DENIED` | `warn` | User cố gắng truy cập lấy URL của file mà không có quyền (ABAC chặn). | `bucket`, `objectKey`, `requestedBy` |

### 2.2. Lỗi Hệ Thống S3 (MinIO Errors)
| `action` (Chuẩn Hóa) | Mức Độ | Mô Tả Nghiệp Vụ | Dữ Liệu `metadata` Đặc Trưng |
| --- | --- | --- | --- |
| `S3_CONNECTION_ERROR` | `error` | Không kết nối được với Server MinIO. | `errorMessage`, `endpoint` |
| `S3_BUCKET_NOT_FOUND` | `error` | Cố gắng tương tác với một bucket chưa được khởi tạo. | `bucket` |

### 2.3. Garbage Collection (Dọn Dẹp File Rác)
| `action` (Chuẩn Hóa) | Mức Độ | Mô Tả Nghiệp Vụ | Dữ Liệu `metadata` Đặc Trưng |
| --- | --- | --- | --- |
| `GC_JOB_STARTED` | `info` | CronJob BullMQ dọn file rác bắt đầu chạy. | `targetBucket` |
| `GC_FILE_PURGED` | `info` | Xóa một file rác (đã quá hạn sinh Presigned URL nhưng không được Confirm). | `bucket`, `objectKey`, `createdAt` |
| `GC_JOB_COMPLETED` | `info` | Job kết thúc. | `totalFilesPurged`, `reclaimedBytes`, `durationMs` |

---

## 3. Quy Tắc Bảo Mật Log (Log Masking)

Tuyệt đối **KHÔNG** ghi các thông tin sau vào Log JSON ra màn hình `stdout` (để tránh rò rỉ khi lưu trên Loki):
1. Chuỗi `Presigned URL` đầy đủ (Vì URL này chứa token ký có thể tải/upload file trực tiếp). Chỉ ghi objectKey.
2. `SecretKey` của MinIO hoặc bất kỳ mật khẩu nào.
