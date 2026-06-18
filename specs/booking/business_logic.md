# Đặc Tả Business Logic Module Đặt Lịch Hẹn

## 1. Thuật Toán Tính Toán Khung Giờ Trống (Available Slots Generator)

Để đảm bảo hiệu năng tính toán nhanh chóng dưới 100ms phục vụ AI Chatbot, thuật toán lọc giờ trống được cài đặt lớp dịch vụ trong NestJS như sau:

```typescript
@Injectable()
export class AvailableSlotsService {
  constructor(
    @InjectRepository(BookingAvailability)
    private readonly availabilityRepo: Repository<BookingAvailability>,
    @InjectRepository(BookingAppointment)
    private readonly appointmentRepo: Repository<BookingAppointment>,
    private readonly googleCalendarService: GoogleCalendarService // Service đồng bộ Google Calendar
  ) {}

  async generateAvailableSlots(
    eventTypeId: string,
    salesId: string,
    startDate: Date,
    endDate: Date,
    durationMinutes: number
  ): Promise<Date[]> {
    const BUFFER_MINUTES = 15; // Thời gian chuẩn bị tối thiểu giữa 2 cuộc hẹn
    const MIN_NOTICE_MS = 2 * 60 * 60 * 1000; // Khách phải đặt lịch trước 2 tiếng
    const nowMs = Date.now();

    // 1. Truy vấn lịch rảnh (working hours) trong tuần của Sales
    const workingHours = await this.availabilityRepo.findBy({ user_id: salesId });
    if (workingHours.length === 0) return [];

    // 2. Truy vấn các cuộc hẹn hiện có trong khoảng thời gian [startDate, endDate]
    const existingAppointments = await this.appointmentRepo.find({
      where: {
        host_id: salesId,
        status: In(['CONFIRMED', 'PENDING']),
        start_time: Between(startDate, endDate)
      }
    });

    // 3. (Mở rộng) Lấy danh sách lịch bận từ Google Calendar API (nếu có liên kết)
    const googleBusySlots = await this.googleCalendarService.getBusySlots(salesId, startDate, endDate);

    const availableSlots: Date[] = [];
    const stepMinutes = durationMinutes + BUFFER_MINUTES;

    // Duyệt qua từng ngày trong khoảng tìm kiếm
    let currentDay = new Date(startDate);
    while (currentDay <= endDate) {
      const dayOfWeek = currentDay.getDay(); // 0 (CN) -> 6 (T7)
      
      // Lấy cấu hình giờ rảnh cho ngày hiện tại
      const dayConfigs = workingHours.filter(cfg => cfg.day_of_week === dayOfWeek);

      for (const config of dayConfigs) {
        // Khởi tạo giờ bắt đầu và kết thúc rảnh của ngày đó
        const [startHour, startMin] = config.start_time.split(':').map(Number);
        const [endHour, endMin] = config.end_time.split(':').map(Number);

        const slotStart = new Date(currentDay);
        slotStart.setHours(startHour, startMin, 0, 0);

        const slotEnd = new Date(currentDay);
        slotEnd.setHours(endHour, endMin, 0, 0);

        // Chia nhỏ thời gian làm việc thành các slot
        let currentSlot = new Date(slotStart);
        while (currentSlot.getTime() + durationMinutes * 60000 <= slotEnd.getTime()) {
          const currentSlotEnd = new Date(currentSlot.getTime() + durationMinutes * 60000);

          // Kiểm tra Rào chắn 1: Khách đặt lịch trước ít nhất 2 tiếng
          if (currentSlot.getTime() - nowMs >= MIN_NOTICE_MS) {
            
            // Kiểm tra Rào chắn 2: Xem có trùng với cuộc hẹn hiện tại nào trong DB không
            const isOverlappingDb = existingAppointments.some(app => {
              const appStart = app.start_time.getTime();
              const appEnd = app.end_time.getTime();
              
              // Có sự giao nhau giữa khoảng [currentSlot, currentSlotEnd] và cuộc hẹn đã có
              return currentSlot.getTime() < appEnd && currentSlotEnd.getTime() > appStart;
            });

            // Kiểm tra Rào chắn 3: Xem có trùng với lịch bận Google Calendar không
            const isOverlappingGoogle = googleBusySlots.some(busy => {
              return currentSlot.getTime() < busy.end.getTime() && currentSlotEnd.getTime() > busy.start.getTime();
            });

            if (!isOverlappingDb && !isOverlappingGoogle) {
              availableSlots.push(new Date(currentSlot));
            }
          }

          // Tăng lên slot tiếp theo
          currentSlot = new Date(currentSlot.getTime() + stepMinutes * 60000);
        }
      }

      // Tăng thêm 1 ngày
      currentDay.setDate(currentDay.getDate() + 1);
    }

    return availableSlots;
  }
}
```

---

## 2. Nghiệp Vụ Tích Hợp CRM & Phân Bổ Round-Robin

Khi cuộc hẹn được tạo, hệ thống tự động gán vai Sales và gộp timeline trong một Database Transaction:

```typescript
@Injectable()
export class AppointmentService {
  constructor(
    @InjectRepository(BookingAppointment)
    private readonly appointmentRepo: Repository<BookingAppointment>,
    @InjectRepository(CrmCustomer)
    private readonly customerRepo: Repository<CrmCustomer>,
    @InjectRepository(CrmActivity)
    private readonly activityRepo: Repository<CrmActivity>,
    @InjectRedis('cache') private readonly redis: Redis,
    private readonly reminderScheduler: ReminderScheduler, // Service BullMQ
    private readonly dataSource: DataSource
  ) {}

  async bookAppointment(dto: CreateAppointmentDto, duration: number): Promise<BookingAppointment> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Phân bổ Sales Rep (Host) theo cơ chế Round-Robin nếu không chỉ định đích danh
      let assignedSalesId = dto.salesId;
      if (!assignedSalesId) {
        assignedSalesId = await this.allocateSalesRoundRobin(dto.startTime, dto.eventTypeId);
      }

      // 2. Tìm kiếm hoặc khởi tạo khách hàng trong CRM (Soft link)
      let customer = await this.customerRepo.findOneBy({ phone_number: dto.customerPhone });
      if (!customer) {
        customer = this.customerRepo.create({
          full_name: dto.customerName,
          phone_number: dto.customerPhone,
          email: dto.customerEmail,
          assignee_id: assignedSalesId
        });
        customer = await queryRunner.manager.save(customer);
      } else {
        // Cập nhật người phụ trách nếu khách hàng chưa có assignee_id
        if (!customer.assignee_id) {
          customer.assignee_id = assignedSalesId;
          await queryRunner.manager.save(customer);
        }
      }

      // 3. Lưu cuộc hẹn
      const endTime = new Date(new Date(dto.startTime).getTime() + duration * 60000);
      const appointment = this.appointmentRepo.create({
        event_type_id: dto.eventTypeId,
        host_id: assignedSalesId,
        customer_id: customer.id,
        customer_name: dto.customerName,
        customer_email: dto.customerEmail,
        customer_phone: dto.customerPhone,
        start_time: new Date(dto.startTime),
        end_time: endTime,
        status: 'CONFIRMED',
        notes: dto.notes
      });
      const savedAppointment = await queryRunner.manager.save(appointment);

      // 4. Lưu ghi vết hoạt động đặt lịch vào Activity Timeline của CRM
      const activity = this.activityRepo.create({
        customer_id: customer.id,
        activity_type: 'NOTE_ADDED', // Logs timeline
        description: `Đã đặt lịch cuộc hẹn: ${dto.startTime} với Sales phụ trách.`,
        payload: {
          appointmentId: savedAppointment.id,
          startTime: dto.startTime,
          hostId: assignedSalesId
        }
      });
      await queryRunner.manager.save(activity);

      await queryRunner.commitTransaction();

      // 5. Lên lịch nhắc nhở 24h & 1h bất đồng bộ thông qua BullMQ
      await this.reminderScheduler.scheduleReminders(savedAppointment);

      return savedAppointment;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async allocateSalesRoundRobin(startTime: string, eventTypeId: string): Promise<string> {
    // 1. Lấy danh sách các Sales Rep rảnh vào giờ này (Working hours OK và không bận appointment)
    const availableSalesIds = await this.getAvailableHostsForSlot(new Date(startTime), eventTypeId);
    if (availableSalesIds.length === 0) {
      throw new BadRequestException('Không có nhân viên Sales nào trống lịch vào khung giờ này');
    }

    availableSalesIds.sort(); // Đảm bảo thứ tự cố định để xoay vòng

    // 2. Lấy con trỏ Round-Robin của lịch hẹn từ Redis
    const pointerKey = `pointer:booking:round_robin:${eventTypeId}`;
    const pointerStr = await this.redis.get(pointerKey);
    let pointer = pointerStr ? parseInt(pointerStr, 10) : 0;

    const assignedIndex = pointer % availableSalesIds.length;
    const assignedSalesId = availableSalesIds[assignedIndex];

    // 3. Tăng con trỏ và lưu lại Redis
    await this.redis.set(pointerKey, (pointer + 1).toString());

    return assignedSalesId;
  }
}
```

---

## 3. Đặc Tả Luồng Phát Sự Kiện Thông Báo (Event-Driven Notification)

> **Nguyên tắc kiến trúc đã chốt:** Booking Module **không tự gửi** Email hay Zalo trực tiếp. Sau khi lưu cuộc hẹn vào DB (trong cùng transaction), Booking phát sự kiện qua `EventEmitter2` và `NotificationModule` đảm nhận toàn bộ việc phân phối thông báo.

### 3.1. Payload Sự Kiện Chuẩn

Payload phát ra phải chứa đầy đủ thông tin cần thiết để Notification Module hoạt động mà không cần truy vấn DB ngoài module:

```typescript
// booking/events/appointment.events.ts
export class AppointmentConfirmedEvent {
  appointmentId: string;
  eventTypeName: string;
  startTime: Date;
  endTime: Date;
  locationType: 'GOOGLE_MEET' | 'PHONE' | 'ONSITE';
  meetLink?: string;
  salesId: string;
  salesName: string;
  salesEmail: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerZaloId?: string;    // Lấy từ crm_customers tại thời điểm booking
}

export class AppointmentCancelledEvent extends AppointmentConfirmedEvent {
  cancelReason?: string;
}
```

### 3.2. Emit Events trong `AppointmentService`

```typescript
// Sau khi queryRunner.commitTransaction() thành công:

// Event 1: Thông báo xác nhận — Lưu vào Outbox
const eventId = uuidv4();
await this.outboxRepo.save({
  event_type: 'appointment.confirmed',
  payload: {
    eventId,
    appointmentId: savedAppointment.id,
  eventTypeName: eventType.title,
  startTime: savedAppointment.start_time,
  endTime: savedAppointment.end_time,
  locationType: eventType.location_type,
  meetLink: savedAppointment.meeting_link,
  salesId: assignedSalesId,
  salesName: salesUser.full_name,
  salesEmail: salesUser.email,
  customerName: dto.customerName,
  customerEmail: dto.customerEmail,
  customerPhone: dto.customerPhone,
    customerZaloId: customer.zalo_user_id,
  }
});

// NOTE: Notification Module sẽ tự động lên lịch reminder 24h và 1h dựa trên startTime
// Booking Outbox Worker sẽ quét bảng booking_outbox_events và đẩy đi.
```

### 3.3. Emit Event Hủy Lịch

```typescript
// Trong cancelAppointment() sau khi cập nhật status = 'CANCELLED':
await this.outboxRepo.save({
  event_type: 'appointment.cancelled',
  payload: {
    eventId: uuidv4(),
    ...appointmentData,  // Spread đầy đủ payload tương tự confirmed
    cancelReason: dto.reason,
  }
});
// Booking Outbox Worker sẽ quét bảng và đẩy đi.
```

---

## 4. Bảo Mật API (API Security & Data Filtering)

### 4.1. Idempotency Guard
API `POST /api/v1/booking/appointments` đặc biệt nhạy cảm với việc click đúp. Bắt buộc yêu cầu Client gửi `Idempotency-Key` (dạng UUID ngẫu nhiên cho mỗi lần mở form).
- Server dùng `SET NX` Redis kiểm tra trùng lặp khóa này. Nếu trùng, trả về `409 Conflict`.

### 4.2. ABAC Data Filtering (Kiểm Soát Dữ Liệu)
API lấy danh sách lịch hẹn (`GET /api/v1/booking/appointments`) phải áp dụng QueryBuilder phân quyền dữ liệu để tránh lấy nhầm lịch của người khác:
```typescript
const query = this.appointmentRepo.createQueryBuilder('appointment');

if (user.role === 'SALES') {
  // Sales chỉ xem các cuộc hẹn mà mình là Host
  query.andWhere('appointment.host_id = :userId', { userId: user.id });
} else if (user.role === 'CUSTOMER') {
  // Khách hàng xem các cuộc hẹn của mình (Nếu có portal khách hàng)
  query.andWhere('appointment.customer_id = :userId', { userId: user.id });
}
// Admin/Manager xem toàn bộ
```
