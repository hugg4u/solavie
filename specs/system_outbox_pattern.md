# Solavie Platform — Transactional Outbox Pattern Specification

| Tài liệu | Transactional Outbox Pattern Specification |
|---|---|
| Dự án | Hệ thống AI Chatbot kết hợp CRM & O&M cho Năng lượng mặt trời Solavie |
| Phiên bản | 1.0.0 |
| Trạng thái | Active |

---

## 1. Vấn Đề Và Định Nghĩa (Problem & Concept)

### 1.1 Dual-Write Problem
Trong kiến trúc Event-Driven Microservices (hoặc Modular Monolith), một thao tác nghiệp vụ thường đi kèm với việc phát tán sự kiện (Publish Event) cho các module khác.
Ví dụ: Khi module IAM tạo nhân viên mới, nó lưu vào Database và đẩy Event `auth.user_created` vào BullMQ để module Notification gửi Email.
- Nếu ghi Database thành công nhưng BullMQ sập → Mất Event, không gửi Email.
- Nếu gửi BullMQ thành công nhưng Database commit lỗi (Rollback) → Gửi Email thành công cho một nhân viên không tồn tại trong DB.
Đây gọi là **Dual-Write Problem**.

### 1.2 Giải pháp Transactional Outbox Pattern
Transactional Outbox Pattern giải quyết bài toán trên bằng cách:
1. Tạo một bảng trung gian gọi là **Outbox Table** ngay trong cùng một Database của module phát sinh.
2. Ghi Event vào bảng Outbox **bên trong cùng một Database Transaction** với thao tác Business Logic. Hệ thống ACID của CSDL đảm bảo cả Business Entity và Outbox Entity đều được Commit hoặc Rollback đồng thời.
3. Sau khi Transaction thành công, một cơ chế **Relay** (Message Relay) sẽ quét bảng Outbox và đẩy dữ liệu vào Message Broker (BullMQ).

---

## 2. Thiết Kế Dữ Liệu (Database Schema)

Tất cả các module khi áp dụng Outbox đều tuân theo cấu trúc bảng Entity sau (Có thể kế thừa từ `BaseOutboxEntity`):

```typescript
@Entity('module_prefix_outbox')
export class ModuleOutboxEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  eventType: string; // VD: 'auth.user_created'

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>; // Data gửi đi

  @Column({ default: 'PENDING' }) // Trạng thái: PENDING, PROCESSING, PROCESSED, FAILED, DEAD_LETTER
  status: string;

  @Column({ default: 0 })
  attempts: number;

  @Column({ nullable: true })
  errorReason: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

---

## 3. Quy Trình Cài Đặt (Implementation Guidelines)

Dưới đây là khuôn mẫu lập trình bắt buộc để đảm bảo 100% Guaranteed Delivery. Kỹ sư tham khảo trực tiếp [users.service.ts](file:///d:/workspace/project/solavie/backend/src/modules/iam/services/users.service.ts) để xem mã nguồn gốc.

### Bước 1: Ghi vào DB trong Transaction
Sử dụng `dataSource.transaction` để lưu cùng lúc:

```typescript
let outboxEventId: string | null = null;

await this.dataSource.transaction(async (manager) => {
  // 1. Thực thi Business Logic
  const userRepo = manager.getRepository(UserEntity);
  await userRepo.save(user);

  // 2. Ghi Outbox Event
  const outboxRepo = manager.getRepository(IamOutboxEntity);
  const outboxEvent = await outboxRepo.save({
    eventType: 'auth.user_created',
    payload: { userId: user.id, email: user.email },
    status: 'PENDING',
  });
  
  // 3. Trả về Event ID
  outboxEventId = outboxEvent.id;
});
```

### Bước 2: Push Trực Tiếp (Direct Queue Trigger - Khuyến Nghị)
Sau khi Transaction commit, Push Event ID vào BullMQ để giảm độ trễ (Realtime). Nếu Push fail thì cũng không sao vì đã có Relay Worker quét lại.

```typescript
if (outboxEventId) {
  try {
    await this.outboxQueue.add('process_event', { eventId: outboxEventId });
  } catch (err) {
    this.logger.warn(`Failed to immediately enqueue outbox event ${outboxEventId}`, err);
  }
}
```

---

## 4. Cơ Chế Worker Relay (Message Relay Mechanism)

Nếu Bước 2 ở trên thất bại (Network Partition, BullMQ restart), hệ thống dựa vào một **Cronjob Sweeper** để cứu vãn.
Tham khảo mã nguồn: [outbox.worker.ts](file:///d:/workspace/project/solavie/backend/src/modules/iam/workers/outbox.worker.ts).

### 4.1. Lock Dữ Liệu Bằng `FOR UPDATE SKIP LOCKED`
Mọi Worker khi đọc bảng Outbox đều phải dùng Pessimistic Lock kết hợp `SKIP LOCKED` để tránh các Worker khác đọc trùng Record và gây Deadlock.

```typescript
const messages = await manager
  .createQueryBuilder(IamOutboxEntity, 'outbox')
  .where('(outbox.status = :pendingStatus OR outbox.status = :failedStatus)', { pendingStatus: 'PENDING', failedStatus: 'FAILED' })
  .setLock('pessimistic_write') // Row-level lock
  .setOnLocked('skip_locked')   // Bỏ qua các row đang bị khóa bởi worker khác
  .getMany();
```

### 4.2. Quản Trị Trạng Thái (State Management)
- **PENDING**: Mới tạo, chờ xử lý.
- **PROCESSING**: Đang được Queue Consumer hoặc Worker xử lý.
- **PROCESSED**: Đã chuyển sang hệ thống khác thành công.
- **FAILED**: Gửi lỗi. Sẽ được Worker thử lại (Retry).
- **DEAD_LETTER**: Thử lại quá 5 lần. Kỹ sư phải can thiệp bằng tay.

### 4.3. Xử lý Logic Outbox (The Consumer)
Tham khảo mã nguồn: [outbox.processor.ts](file:///d:/workspace/project/solavie/backend/src/modules/iam/processors/outbox.processor.ts).
Consumer đọc Event ID từ BullMQ, load lại bản ghi từ CSDL (check lock `PROCESSING`), thực thi `executeEventLogic()`. Nếu thành công, update thành `PROCESSED`.

---

## 5. Ngoại Lệ: Trade-off Hiệu Năng Với Direct Event

Trong một số Use-case đặc biệt, tần suất xảy ra là cực kỳ khổng lồ và mức độ quan trọng không đe doạ tính toàn vẹn hệ thống (Non-Critical), ta có quyền **đánh đổi Guaranteed Delivery lấy Performance** bằng cách Bypass Transactional Outbox.

**Ví dụ:** Luồng Login và `LoginNewDeviceEvent` trong [auth.service.ts](file:///d:/workspace/project/solavie/backend/src/modules/iam/services/auth.service.ts). 
Hệ thống cho phép Push trực tiếp `payload` vào BullMQ mà không ghi vào Database:

```typescript
// Bỏ qua Transaction DB
await this.outboxQueue.add('process_event', {
  eventType: 'auth.login_new_device',
  payload: new LoginNewDeviceEvent(...),
});
```
- **Ưu điểm:** Giảm DB Lock, giảm dung lượng CSDL.
- **Nhược điểm:** Nếu BullMQ sập ngay lúc đó, Event mất vĩnh viễn (Không gửi email cảnh báo thiết bị lạ).
- **Quyết định (By Design):** Đây là đánh đổi có chủ ý từ Kiến trúc sư (Hoàng tử), không phải lỗi hệ thống. Tuyệt đối không lạm dụng ngoại lệ này cho các luồng cốt lõi (Tạo user, Phân quyền, Billing).

---

## 6. Cleanup Cơ Sở Dữ Liệu (Garbage Collection)
Cơ sở dữ liệu Outbox sẽ phình to rất nhanh. Bắt buộc mỗi module phải có một Cronjob Cleanup chạy hàng ngày (Daily):
- Xoá Event `PROCESSED` quá 7 ngày.
- Xoá Event `DEAD_LETTER` quá 30 ngày (Sau khi Admin đã audit). 
Tham khảo hàm `purgeProcessedOutbox` trong `outbox.worker.ts`.
