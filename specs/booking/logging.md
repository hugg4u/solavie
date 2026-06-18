# Logging & Monitoring — Module Đặt Lịch Hẹn (Booking)

## 1. Cấu Trúc Log Chuẩn (Structured JSON Logging)

### 1.1. Log khi tính giờ trống (Available Slots)
```json
{
  "timestamp": "2026-06-16T03:00:00.000Z",
  "level": "info",
  "module": "Booking",
  "context": "AvailableSlotsService",
  "message": "Calculated available slots",
  "traceId": "req_trace_uuid",
  "metadata": {
    "eventTypeId": "uuid",
    "salesId": "uuid",
    "startDate": "2026-06-17",
    "endDate": "2026-06-20",
    "totalSlots": 24,
    "google_busy_count": 3,
    "db_conflict_count": 2,
    "duration_ms": 87
  }
}
```

### 1.2. Log khi cuộc hẹn được tạo thành công
```json
{
  "timestamp": "2026-06-16T03:00:05.000Z",
  "level": "info",
  "module": "Booking",
  "context": "AppointmentService",
  "message": "Appointment booked successfully",
  "traceId": "req_trace_uuid",
  "metadata": {
    "appointmentId": "uuid",
    "eventTypeId": "uuid",
    "hostId": "uuid",
    "customerId": "uuid",
    "startTime": "2026-06-20T08:00:00.000Z",
    "assignmentMethod": "ROUND_ROBIN",
    "notification_event_emitted": "appointment.confirmed"
  }
}
```

### 1.3. Log khi emit Event Thông báo
```json
{
  "timestamp": "2026-06-16T03:00:05.100Z",
  "level": "info",
  "module": "Booking",
  "context": "AppointmentService",
  "message": "Notification event emitted",
  "traceId": "req_trace_uuid",
  "metadata": {
    "event_type": "appointment.confirmed",
    "appointmentId": "uuid",
    "payload_has_zalo_id": true
  }
}
```

### 1.4. Log khi cuộc hẹn bị hủy
```json
{
  "timestamp": "2026-06-16T03:10:00.000Z",
  "level": "warn",
  "module": "Booking",
  "context": "AppointmentService",
  "message": "Appointment cancelled",
  "traceId": "req_trace_uuid",
  "metadata": {
    "appointmentId": "uuid",
    "cancelledBy": "SALES",
    "reason": "Customer request",
    "notification_event_emitted": "appointment.cancelled"
  }
}
```

### 1.5. Log khi Round-Robin không có Sales rảnh
```json
{
  "timestamp": "2026-06-16T03:00:05.000Z",
  "level": "error",
  "module": "Booking",
  "context": "AppointmentService",
  "message": "No available sales rep for round-robin allocation",
  "traceId": "req_trace_uuid",
  "metadata": {
    "eventTypeId": "uuid",
    "requestedSlot": "2026-06-20T08:00:00.000Z",
    "error": "NO_AVAILABLE_HOST"
  }
}
```

---

## 2. Labels cho Promtail/Loki

- `module`: "Booking"
- `context`: AvailableSlotsService | AppointmentService
- `level`: info | warn | error

---

## 3. Metrics Cần Expose (Prometheus)

```
booking_appointment_total{status="CONFIRMED"}
booking_appointment_total{status="CANCELLED"}
booking_appointment_total{status="NO_SHOW"}
booking_slots_calculation_duration_ms{quantile="0.95"}
booking_roundrobin_no_host_total
```
