# Đặc Tả Business Logic Module CRM

## 1. Thuật Toán Tính Toán ROI Solar
Tự động tính toán khi khách hàng cung cấp diện tích mái và hóa đơn tiền điện.

### Công thức:
1. **Công suất tối đa (mái tôn):** `P_max = Diện tích mái / 6` (kWp)
2. **Công suất mục tiêu (theo tiền điện):**
   - Lượng điện tiêu thụ 1 tháng = `Tiền điện / 2700 VNĐ`
   - `P_target = (Điện 1 tháng) / (Giờ nắng * 0.8 * 30)`
3. **Công suất đề xuất:** `P = min(P_max, P_target)`
4. **Chi phí đầu tư:** `P * 14,000,000 VNĐ`
5. **Tiền tiết kiệm 1 năm:** `P * Giờ nắng * 0.8 * 365 * 2700`
6. **Thời gian hoàn vốn (ROI):** `Chi phí đầu tư / Tiền tiết kiệm 1 năm`

## 2. Thuật Toán Gộp Hồ Sơ (Merge Profiles)
Khi hệ thống bắt được Event `customer.created` hoặc tin nhắn mới, sẽ check số điện thoại:
- Nếu trùng: Gộp dữ liệu theo quy tắc:
  - Thông tin bị khuyết ở Primary sẽ lấy từ Secondary đắp vào.
  - Thông tin xung đột: Giữ thông tin của Secondary (mới nhất), đẩy thông tin cũ vào Note (`crm_activities`).
  - Trỏ ID Messenger/Zalo của Secondary về Primary.
  - Soft-delete Secondary.

## 3. Dynamic Pipeline Constraint (Ràng buộc kéo thả)
- Khi Sales gọi API `PATCH /api/v1/crm/customers/:id/stage` để chuyển từ Stage A sang Stage B.
- Hệ thống query bảng `crm_stages` để lấy danh sách `required_fields` của Stage B.
- Duyệt qua `custom_fields` của khách hàng. Nếu thiếu bất kỳ field nào trong `required_fields` -> Throw Exception HTTP 400.

## 4. Dynamic Lead Scoring
- Mỗi khi `custom_fields` hoặc thuộc tính chính bị thay đổi, Trigger hàm `recalculateScore(customerId)`.
- Duyệt qua toàn bộ `crm_scoring_rules` có `is_active = true`.
- Thực thi Eval Logic tương ứng. Cộng dồn tổng điểm vào `lead_score`.
- Cập nhật `lead_temperature`:
  - `< 40`: COLD
  - `40 - 70`: WARM
  - `> 70`: HOT
- Nếu trạng thái vừa đổi thành HOT, phát Event `crm.lead.hot` để bắn thông báo.

---

## 5. Nghiệp Vụ Audit Logging & Hoàn Tác (CRM Data Undo)

Để hỗ trợ khả năng khôi phục dữ liệu nghiệp vụ nhanh chóng và chính xác khi nhân viên thao tác sai, hệ thống triển khai cơ chế Audit và Hoàn tác tập trung.

### 5.1. Phạm vi theo dõi Audit
Chỉ áp dụng ghi nhận nhật ký thay đổi đối với các thực thể cốt lõi mang tính nghiệp vụ trực tiếp để tránh phình to cơ sở dữ liệu:
*   `crm_customers` (Hồ sơ khách hàng/Lead)
*   `crm_stages` (Trạng thái Pipeline)
*   `crm_scoring_rules` (Luật tính điểm)

### 5.2. Nguyên tắc hoạt động của TypeORM Subscriber (Auto Logging)
Sử dụng TypeORM EventSubscriber để tự động bắt các thay đổi ở tầng ORM mà không cần viết mã thủ công ở từng Service:

```typescript
import { EventSubscriber, EntitySubscriberInterface, InsertEvent, UpdateEvent, RemoveEvent } from 'typeorm';
import { CrmCustomer } from './entities/crm-customer.entity';
import { CrmAuditLog } from './entities/crm-audit-log.entity';

@EventSubscriber()
export class CrmAuditSubscriber implements EntitySubscriberInterface {
  listenTo() {
    return CrmCustomer; // Theo dõi thực thể Customer
  }

  async afterInsert(event: InsertEvent<any>) {
    await this.writeLog(event, 'INSERT', null, event.entity);
  }

  async beforeUpdate(event: UpdateEvent<any>) {
    // Chụp lại snapshot trước khi update
    const oldEntity = event.databaseEntity;
    const newEntity = event.entity;
    await this.writeLog(event, 'UPDATE', oldEntity, newEntity);
  }

  async beforeRemove(event: RemoveEvent<any>) {
    const oldEntity = event.databaseEntity;
    await this.writeLog(event, 'DELETE', oldEntity, null);
  }

  private async writeLog(event: any, action: string, oldVal: any, newVal: any) {
    const traceId = event.queryRunner.data?.traceId || null;
    const actorId = event.queryRunner.data?.actorId || null;

    const auditRepository = event.manager.getRepository(CrmAuditLog);
    const log = auditRepository.create({
      table_name: event.metadata.tableName,
      record_id: oldVal?.id || newVal?.id,
      action,
      old_values: oldVal ? this.sanitizeFields(oldVal) : null,
      new_values: newVal ? this.sanitizeFields(newVal) : null,
      actor_id: actorId,
      trace_id: traceId,
    });
    await event.manager.save(log);
  }

  private sanitizeFields(entity: any): any {
    // Loại bỏ các trường nhạy cảm hoặc không cần thiết trước khi lưu JSONB (ví dụ password hash)
    const { password, ...clean } = entity;
    return clean;
  }
}
```

### 5.3. Quy trình khôi phục và xử lý lỗi trong CrmUndoService
Khi thực hiện Undo, service sẽ khôi phục dữ liệu cũ dựa trên trường `action` của log:
1.  **UPDATE:** Thực hiện ghi đè toàn bộ cột của bản ghi hiện tại bằng `old_values`.
2.  **DELETE:**
    *   Nếu bảng hỗ trợ *Soft Delete* (có cột `deleted_at`): Đặt lại `deleted_at = NULL`.
    *   Nếu bảng sử dụng *Hard Delete* (xóa vĩnh viễn): Thực hiện lệnh `INSERT` mới sử dụng toàn bộ cấu trúc dữ liệu trong `old_values`.
3.  **INSERT:** Thực hiện xóa bản ghi vừa tạo (nếu bản ghi đó đã phát sinh quan hệ ràng buộc ở bảng khác, hệ thống sẽ chặn không cho phép Undo và ném ra exception rõ ràng).

*Nguyên tắc toàn vẹn:* Tất cả các bước trong luồng Undo phải chạy chung một Database Transaction. Nếu một câu lệnh SQL thất bại, toàn bộ quá trình rollback lập tức để tránh tình trạng dữ liệu mồ côi hoặc không nhất quán.

