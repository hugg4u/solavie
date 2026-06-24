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

## 2. Thuật Toán Gộp Hồ Sơ (Merge Profiles) & Khóa Phân Tán
Khi hệ thống bắt được Event `customer.created` hoặc tin nhắn mới, sẽ check số điện thoại:
- **Áp dụng Distributed Lock (Redis Lock):** 
  - Trước khi chạy xử lý gộp, hệ thống bắt buộc phải acquire khóa Redis: `SET lock:merge:${phone_number} "locked" NX PX 10000` (TTL: 10 giây).
  - Nếu không lấy được lock (đang có một tiến trình gộp SĐT này chạy song song): Cho request đợi (Retry after 1s) hoặc bỏ qua nếu là webhook trùng lặp.
- Nếu trùng SĐT và lấy được lock thành công: Tiến hành gộp dữ liệu theo quy tắc:
  - Thông tin bị khuyết ở Primary sẽ lấy từ Secondary đắp vào.
  - Thông tin xung đột: Giữ thông tin của Secondary (mới nhất), đẩy thông tin cũ vào Note (`crm_activities`).
  - Trỏ ID Messenger/Zalo của Secondary về Primary.
  - **Liên kết hội thoại:** Cập nhật `customer_id` của tất cả các cuộc hội thoại (`chat_conversations`) đang trỏ tới Secondary ID sang trỏ tới Primary ID để gộp chung dòng thời gian chat đa kênh.
  - Soft-delete Secondary.
  - Sau khi hoàn thành và commit transaction, giải phóng khóa: `DEL lock:merge:${phone_number}`.


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

---

## 6. Nghiệp Vụ Ghi Chú Khách Hàng (Customer Take-Note CRUD & Guards)

Khi quản lý ghi chú, hệ thống kiểm soát quyền chỉnh sửa chặt chẽ để bảo vệ thông tin:

```typescript
@Injectable()
export class CustomerNotesService {
  constructor(
    @InjectRepository(CrmCustomerNote)
    private readonly noteRepo: Repository<CrmCustomerNote>,
    @InjectRepository(CrmCustomer)
    private readonly customerRepo: Repository<CrmCustomer>
  ) {}

  async createNote(customerId: string, content: string, agentId: string): Promise<CrmCustomerNote> {
    const customer = await this.customerRepo.findOneBy({ id: customerId });
    if (!customer) {
      throw new NotFoundException('Không tìm thấy hồ sơ khách hàng');
    }

    const note = this.noteRepo.create({
      customer_id: customerId,
      created_by: agentId,
      content,
      is_pinned: false
    });
    return this.noteRepo.save(note);
  }

  async updateNote(noteId: string, content: string, agentId: string, isAdmin: boolean): Promise<CrmCustomerNote> {
    const note = await this.noteRepo.findOneBy({ id: noteId });
    if (!note) {
      throw new NotFoundException('Không tìm thấy ghi chú');
    }

    // Phân quyền: Chỉ chủ sở hữu ghi chú hoặc Admin mới có quyền cập nhật
    if (note.created_by !== agentId && !isAdmin) {
      throw new ForbiddenException('Bạn không có quyền chỉnh sửa ghi chú này');
    }

    note.content = content;
    note.updated_at = new Date();
    return this.noteRepo.save(note);
  }

  async deleteNote(noteId: string, agentId: string, isAdmin: boolean): Promise<void> {
    const note = await this.noteRepo.findOneBy({ id: noteId });
    if (!note) {
      throw new NotFoundException('Không tìm thấy ghi chú');
    }

    // Phân quyền: Chỉ chủ sở hữu ghi chú hoặc Admin mới có quyền xóa
    if (note.created_by !== agentId && !isAdmin) {
      throw new ForbiddenException('Bạn không có quyền xóa ghi chú này');
    }

    await this.noteRepo.remove(note);
  }

  async togglePin(noteId: string, isPinned: boolean, agentId: string, isAdmin: boolean): Promise<CrmCustomerNote> {
    const note = await this.noteRepo.findOneBy({ id: noteId });
    if (!note) {
      throw new NotFoundException('Không tìm thấy ghi chú');
    }

    // Bất kỳ Sales nào được phân quyền crm:notes:write đều có thể ghim/bỏ ghim ghi chú
    note.is_pinned = isPinned;
    return this.noteRepo.save(note);
  }

  async getNotes(customerId: string, page = 1, limit = 10): Promise<[CrmCustomerNote[], number]> {
    // Luôn đưa ghi chú được ghim (is_pinned = true) lên trước, sau đó sắp xếp theo thời gian tạo mới nhất
    return this.noteRepo.findAndCount({
      where: { customer_id: customerId },
      order: {
        is_pinned: 'DESC',
        created_at: 'DESC'
      },
      skip: (page - 1) * limit,
      take: limit
    });
  }
}
```

---

## 7. Đặc Tả Triển Khai Dịch Vụ Gộp Hồ Sơ Tự Động (MergeProfileService Pseudocode)

Dịch vụ chạy ngầm hợp nhất hai hồ sơ khách hàng bị trùng số điện thoại, bảo vệ bằng khóa phân tán Redis Lock và lưu vết các xung đột trường dữ liệu nhu cầu Solar vào ghi chú viết tay.

```typescript
@Injectable()
export class MergeProfileService {
  private readonly logger = new Logger(MergeProfileService.name);

  constructor(
    @InjectRedis('cache') private readonly redis: Redis,
    @InjectRepository(CrmCustomer)
    private readonly customerRepo: Repository<CrmCustomer>,
    @InjectRepository(CrmCustomerNote)
    private readonly noteRepo: Repository<CrmCustomerNote>,
    @InjectRepository(ChatConversation)
    private readonly conversationRepo: Repository<ChatConversation>,
    @InjectRepository(CrmActivity)
    private readonly activityRepo: Repository<CrmActivity>,
  ) {}

  /**
   * Tự động gộp hồ sơ dựa trên số điện thoại
   */
  async autoMergeByPhone(phoneNumber: string): Promise<void> {
    const lockKey = `lock:merge:phone:${phoneNumber}`;
    const requestId = uuidv4();

    // 1. Acquire Distributed Redis Lock (10 giây)
    const isLocked = await this.redis.set(lockKey, requestId, 'NX', 'PX', 10000);
    if (isLocked !== 'OK') {
      this.logger.warn(`Số điện thoại ${phoneNumber} đang được xử lý gộp bởi tiến trình khác. Bỏ qua.`);
      return;
    }

    try {
      // 2. Tìm các hồ sơ trùng SĐT
      const profiles = await this.customerRepo.find({
        where: { phone_number: phoneNumber },
        order: { created_at: 'ASC' } // Ưu tiên bản ghi tạo trước làm master
      });

      if (profiles.length <= 1) return;

      const master = profiles[0];
      const slaves = profiles.slice(1);

      for (const slave of slaves) {
        await this.mergeTwoProfiles(master, slave);
      }

    } finally {
      // 3. Giải phóng lock bằng script Lua an toàn
      const releaseScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await this.redis.eval(releaseScript, 1, lockKey, requestId);
    }
  }

  /**
   * Thực hiện gộp hai hồ sơ trong database transaction
   */
  private async mergeTwoProfiles(master: CrmCustomer, slave: CrmCustomer): Promise<void> {
    await this.customerRepo.manager.transaction(async (manager) => {
      // A. Hợp nhất thông tin cá nhân (Ưu tiên chuỗi có giá trị và dài hơn)
      if (!master.full_name && slave.full_name) {
        master.full_name = slave.full_name;
      } else if (master.full_name && slave.full_name) {
        master.full_name = master.full_name.length >= slave.full_name.length ? master.full_name : slave.full_name;
      }
      if (!master.email && slave.email) master.email = slave.email;
      if (!master.location && slave.location) master.location = slave.location;
      
      // Gộp các định danh Social media
      if (!master.facebook_psid && slave.facebook_psid) master.facebook_psid = slave.facebook_psid;
      if (!master.zalo_user_id && slave.zalo_user_id) master.zalo_user_id = slave.zalo_user_id;

      // B. Hợp nhất thuộc tính nhu cầu Solar (Custom Fields)
      const overwrittenFields: Record<string, any> = {};
      const masterCustom = master.custom_fields || {};
      const slaveCustom = slave.custom_fields || {};

      for (const [key, value] of Object.entries(slaveCustom)) {
        if (masterCustom[key] !== undefined && masterCustom[key] !== value) {
          // Xung đột: Ưu tiên giữ dữ liệu của profile mới nhất (slave), lưu lại giá trị cũ của master
          overwrittenFields[key] = masterCustom[key];
          masterCustom[key] = value;
        } else if (masterCustom[key] === undefined) {
          masterCustom[key] = value;
        }
      }
      master.custom_fields = masterCustom;

      // C. Lưu Master Profile
      await manager.save(master);

      // D. Lưu vết các trường bị ghi đè vào crm_customer_notes
      if (Object.keys(overwrittenFields).length > 0) {
        await manager.save(CrmCustomerNote, {
          customer_id: master.id,
          created_by: null, // Ghi chú hệ thống
          content: `[SYSTEM_MERGE_OVERWRITE] Hệ thống tự động gộp hồ sơ từ profile trùng lặp (ID: ${slave.id}). ` +
                   `Dữ liệu cũ của Master Profile đã bị thay đổi: ${JSON.stringify(overwrittenFields)}`,
          is_pinned: false
        });
      }

      // E. Chuyển đổi ID chủ sở hữu trong chat_conversations và crm_activities
      await manager.createQueryBuilder()
        .update(ChatConversation)
        .set({ customer_id: master.id })
        .where('customer_id = :slaveId', { slaveId: slave.id })
        .execute();

      await manager.createQueryBuilder()
        .update(CrmActivity)
        .set({ customer_id: master.id })
        .where('customer_id = :slaveId', { slaveId: slave.id })
        .execute();

      // F. Xóa mềm (Soft Delete) profile phụ
      await manager.softRemove(slave);

      this.logger.log(`Hợp nhất thành công Profile phụ ${slave.id} vào Master Profile ${master.id}`);
    });
  }
}
```


