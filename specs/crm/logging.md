# Quy Chuẩn Ghi Log Module CRM

Mọi hoạt động nghiệp vụ nhạy cảm liên quan đến hồ sơ khách hàng phải được lưu vết trong Cơ sở dữ liệu và ghi log hệ thống dạng JSON ra stdout phục vụ giám sát tập trung.

---

## 1. Lưu Vết Hoạt Động Khách Hàng (Database CRM Activities)
Hành trình tương tác của khách hàng được ghi nhận vào bảng `crm_activities` trong Database để hiển thị dạng Timeline 360 độ trên màn hình tư vấn:
*   Các sự kiện bắt buộc ghi: `STAGE_CHANGE`, `CHAT_MESSAGE`, `ROI_CALC`, `NOTE_ADDED`, `LEAD_MERGED`.
*   Cấu trúc payload lưu trữ trong DB (trường `payload` dạng JSONB):
    ```json
    {
      "event_type": "STAGE_CHANGE",
      "previous_stage": "NEW",
      "new_stage": "CONTACTED",
      "reason": "AI đã thu thập đủ SĐT và địa điểm lắp đặt"
    }
    ```

---

## 2. Hệ Thống System Logs (Promtail & Grafana Loki)

Các tiến trình nghiệp vụ trong module CRM phải được in ra log stdout dạng JSON để Promtail Scrape và Loki lập chỉ mục.

### 2.1. Mẫu Log Kéo Thả Trạng Thái Lead (Lead Stage Change Log)
Ghi log khi trạng thái của Lead được cập nhật.

```json
{
  "timestamp": "2026-06-15T16:40:00.123Z",
  "level": "info",
  "module": "CRM",
  "context": "LEAD_STAGE_SERVICE",
  "message": "Lead stage updated successfully",
  "traceId": "t_crm_881023_trace",
  "metadata": {
    "lead_id": "lead_uuid_1029",
    "previous_stage": "NEW",
    "new_stage": "CONTACTED",
    "updated_by": "usr_sales_uuid_445"
  }
}
```

### 2.2. Mẫu Log Sự Kiện Gộp Trùng Hồ Sơ (Lead Profile Merge Log)
Ghi log khi phát hiện trùng số điện thoại trên các kênh chat và tiến hành gộp profile về profile chính.

```json
{
  "timestamp": "2026-06-15T16:41:05.456Z",
  "level": "info",
  "module": "CRM",
  "context": "LEAD_MERGE_SERVICE",
  "message": "Duplicate customer profiles merged successfully",
  "traceId": "t_crm_881024_trace",
  "metadata": {
    "primary_lead_id": "lead_uuid_1029",
    "merged_lead_ids": ["lead_uuid_3092"],
    "phone_number": "0912345678",
    "facebook_psid": "psid_8829102",
    "zalo_user_id": "zalo_330920"
  }
}
```

### 2.3. Mẫu Log Lỗi DB Transaction Khi Gộp Profiles (DB Merge Transaction Error)
Ghi log cảnh báo mức `error` khi transaction gộp profiles bị rollback do lỗi cơ sở dữ liệu.

```json
{
  "timestamp": "2026-06-15T16:41:06.100Z",
  "level": "error",
  "module": "CRM",
  "context": "LEAD_MERGE_SERVICE",
  "message": "Database transaction failed during profiles merge. Rollback triggered.",
  "traceId": "t_crm_881024_trace",
  "metadata": {
    "primary_lead_id": "lead_uuid_1029",
    "merged_lead_ids": ["lead_uuid_3092"],
    "db_error_code": "23505",
    "error_message": "Key (facebook_psid)=(psid_8829102) already exists in unique constraint"
  }
}
```

### 2.4. Mẫu Log Lỗi Tính ROI do Thiếu Dữ Liệu (ROI Calculator Warning)
Ghi log mức `warn` khi bộ tính toán ROI không thể tìm thấy bức xạ mặt trời (giờ nắng) của địa phương trong bảng tham chiếu.

```json
{
  "timestamp": "2026-06-15T16:42:12.789Z",
  "level": "warn",
  "module": "CRM",
  "context": "ROI_CALCULATOR_SERVICE",
  "message": "Solar hours metadata not found for requested location. Fallback activated.",
  "traceId": "t_crm_881025_trace",
  "metadata": {
    "requested_location": "Huyện đảo Hoàng Sa",
    "fallback_solar_hours": 4.2,
    "lead_id": "lead_uuid_1029"
  }
}
```

---

### 2.5. Mẫu Log Khóa Phân Tán (Distributed Redis Lock Logs)

#### 2.5.1. Log Chiếm Khóa Thành Công (Lock Acquired Success)
Ghi log khi một tiến trình chiếm thành công khóa phân tán dựa trên số điện thoại của lead.
```json
{
  "timestamp": "2026-06-15T16:41:00.005Z",
  "level": "info",
  "module": "CRM",
  "context": "DISTRIBUTED_LOCK_SERVICE",
  "message": "Distributed lock acquired successfully",
  "traceId": "t_crm_881024_trace",
  "metadata": {
    "lock_key": "lock:merge:0912345678",
    "request_uuid": "req_uuid_9921ab012",
    "ttl_ms": 10000
  }
}
```

#### 2.5.2. Log Lấy Khóa Thất Bại & Thử Lại (Lock Acquisition Failed - Retrying)
Ghi log mức `warn` khi tiến trình gộp trùng bị chặn bởi một luồng xử lý khác và thực hiện backoff/retry.
```json
{
  "timestamp": "2026-06-15T16:41:01.010Z",
  "level": "warn",
  "module": "CRM",
  "context": "DISTRIBUTED_LOCK_SERVICE",
  "message": "Failed to acquire distributed lock, retrying...",
  "traceId": "t_crm_881024_trace",
  "metadata": {
    "lock_key": "lock:merge:0912345678",
    "attempt": 1,
    "max_attempts": 3,
    "backoff_ms": 1000
  }
}
```

#### 2.5.3. Log Giải Phóng Khóa Thành Công (Lock Released)
Ghi log sau khi hoàn tất gộp hồ sơ, commit transaction và giải phóng khóa phân tán an toàn.
```json
{
  "timestamp": "2026-06-15T16:41:02.500Z",
  "level": "info",
  "module": "CRM",
  "context": "DISTRIBUTED_LOCK_SERVICE",
  "message": "Distributed lock released successfully",
  "traceId": "t_crm_881024_trace",
  "metadata": {
    "lock_key": "lock:merge:0912345678",
    "request_uuid": "req_uuid_9921ab012",
    "release_status": "SUCCESS"
  }
}
```

