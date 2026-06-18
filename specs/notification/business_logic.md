# Business Logic — Module Notification

## 1. Luật Định Tuyến Kênh (Channel Routing Rules)

### Quy tắc 1: Staff (Nhân viên) chỉ nhận In-App + Email
```
recipient_type = 'staff'
  → ALWAYS: in_app (trừ khi socket đang offline thì log SKIPPED + fallback Email)
  → EMAIL: chỉ khi event thuộc loại cần Email theo bảng mapping (xem requirement §2.2)
  → ZALO: KHÔNG áp dụng cho Staff
```

### Quy tắc 2: Customer (Khách hàng) chỉ nhận Email + Zalo ZNS
```
recipient_type = 'customer'
  → NEVER: in_app (khách hàng không có tài khoản Sales Portal)
  → EMAIL: nếu customer.email không null
  → ZALO: nếu customer.zalo_user_id không null
  → Nếu cả 2 đều available → Fan-out gửi cả Email + Zalo ZNS
  → Nếu chỉ có email → Email only
  → Nếu chỉ có zalo_user_id → Zalo only
  → Nếu không có gì → Skip, log warning
```

### Quy tắc 3: Quiet Hours (chỉ áp dụng cho Email của Staff)
```
IF notification_preferences.quiet_hours_start IS NOT NULL
  AND current_time BETWEEN quiet_hours_start AND quiet_hours_end
  AND channel = 'email'
  AND recipient_type = 'staff'
THEN
  → Status: SKIPPED, skip_reason: 'QUIET_HOURS'
  → In-App vẫn được gửi bình thường
```

### Quy tắc 4: Opt-out per channel
```
IF notification_preferences.email_enabled = false AND channel = 'email'
THEN → SKIPPED, skip_reason: 'PREFERENCE_OPT_OUT'

IF notification_preferences.event_overrides['<event_type>']['email'] = false
THEN → SKIPPED (event-level override > global setting)
```

---

## 2. Business Logic Xử Lý Từng Event

### 2.1. `chat.handover_requested`

**Trigger**: Chatbot Module phát khi AI handover sang MANUAL.

**Payload nhận vào**:
```typescript
{
  conversationId: string,
  customerName: string,
  customerChannel: 'facebook' | 'zalo' | 'web',
  lastMessage: string,
  assigneeId: string,       // Sales được gán (Round-Robin)
}
```

**Logic xử lý**:
1. Tier: **CRITICAL** → gửi In-App trực tiếp.
2. Tạo notification content: `"Khách hàng {{customerName}} (kênh {{channel}}) đang chờ tư vấn."`
3. Gọi `InAppProvider.send({ to: assigneeId, body: notificationData })`.
4. Socket.io emit event `notification:handover` kèm `conversationId` để Portal tự navigate.
5. Không gửi Email cho event này.

---

### 2.2. `inbox.agent_mentioned`

**Trigger**: Inbox Module phát khi Sales gõ `@username` trong Internal Comment.

**Payload**:
```typescript
{
  conversationId: string,
  mentionedUserId: string,   // Sales bị mention
  mentionerName: string,     // Sales đang gõ
  commentSnippet: string,    // 50 ký tự đầu của comment
}
```

**Logic xử lý**:
1. Tier: **CRITICAL** → In-App only.
2. Không cần check preferences (Tier 1 luôn gửi).
3. Socket.io emit `notification:mention`.

---

### 2.3. `lead.assigned`

**Trigger**: CRM Module phát khi Admin/Manager gán Lead cho Sales.

**Payload**:
```typescript
{
  leadId: string,
  leadName: string,
  leadPhone: string,
  assigneeId: string,
  assigneeEmail: string,
  previousAssigneeId?: string,
}
```

**Logic xử lý**:
1. Tier: **TRANSACTIONAL**.
2. Kiểm tra Idempotency.
3. Gửi In-App: `"Bạn vừa được gán khách hàng mới: {{leadName}} ({{leadPhone}})"`.
4. Gửi Email (nếu không Quiet Hours): Template `lead.assigned` với link CRM tới Lead profile.
5. Không gửi Zalo (Staff event).

---

### 2.4. `lead.score_hot`

**Trigger**: CRM Score Engine phát khi Lead đạt ngưỡng HOT (score ≥ ngưỡng cấu hình).

**Payload**:
```typescript
{
  leadId: string,
  leadName: string,
  leadScore: number,
  assigneeId: string,
  managerId?: string,   // Nếu có Manager được cấu hình nhận alert HOT Lead
}
```

**Logic xử lý**:
1. Gửi In-App + Email cho **cả** `assigneeId` và `managerId` (nếu có).
2. Idempotency key phải tính riêng cho từng recipient: `SHA256(lead.score_hot:leadId:assigneeId:in_app)`.

---

### 2.5. `appointment.confirmed`

**Trigger**: Booking Module phát khi cuộc hẹn được tạo/xác nhận thành công.

**Payload**:
```typescript
{
  appointmentId: string,
  eventTypeName: string,
  startTime: Date,
  endTime: Date,
  locationType: 'GOOGLE_MEET' | 'PHONE' | 'ONSITE',
  meetLink?: string,
  salesId: string,
  salesName: string,
  salesEmail: string,
  customerName: string,
  customerEmail: string,
  customerPhone: string,
  customerZaloId?: string,
}
```

**Logic xử lý**:
1. **Sales Rep** → In-App + Email xác nhận.
2. **Khách hàng** → Email + Zalo ZNS (nếu có `customerZaloId`).
3. **Lên lịch reminder jobs**:
   ```
   delay_24h = (startTime - 24 giờ) - Date.now()  [ms]
   delay_1h  = (startTime - 1 giờ)  - Date.now()  [ms]

   IF delay_24h > 0:
     BullMQ.add('scheduled-notification-queue', reminder24hJob, { delay: delay_24h })
   IF delay_1h > 0:
     BullMQ.add('scheduled-notification-queue', reminder1hJob, { delay: delay_1h })
   ```
4. Lưu `jobId` của 2 reminder jobs vào `notification_logs` (trường `metadata`) để có thể hủy sau.

---

### 2.6. `appointment.cancelled`

**Trigger**: Booking Module phát khi Sales/khách hủy cuộc hẹn.

**Payload**: Giống `appointment.confirmed` nhưng không có `meetLink`.

**Logic xử lý**:
1. **Hủy các reminder jobs hiện tại**:
   ```
   Tìm notification_logs WHERE event_entity_id = appointmentId
     AND event_type IN ('appointment.reminder_24h', 'appointment.reminder_1h')
     AND status = 'QUEUED'
   
   Với mỗi log tìm được:
     BullMQ.remove(log.metadata.jobId)
     notification_logs UPDATE status='SKIPPED', skip_reason='APPOINTMENT_CANCELLED'
   ```
2. Gửi thông báo hủy cho Sales (In-App + Email) và Khách hàng (Email + Zalo ZNS).

---

### 2.7. `appointment.reminder_24h` và `appointment.reminder_1h`

**Trigger**: BullMQ ScheduledWorker xử lý delayed job.

**Logic xử lý `reminder_1h`**:
- Nếu `locationType = 'GOOGLE_MEET'` → Email + Zalo ZNS **phải đính kèm `meetLink`**.
- Nếu `locationType = 'PHONE'` → Email + Zalo ZNS ghi rõ "chúng tôi sẽ gọi cho quý khách".
- Nếu `locationType = 'ONSITE'` → Nhắc địa chỉ + thời gian.

---

### 2.8. `auth.login_new_device`

**Trigger**: IAM Module phát khi phát hiện đăng nhập từ thiết bị/IP lạ.

**Payload**:
```typescript
{
  userId: string,
  userEmail: string,
  deviceInfo: string,
  ipAddress: string,
  loginTime: Date,
}
```

**Logic xử lý**:
1. Tier: **TRANSACTIONAL**.
2. Gửi **Email bảo mật** — không có In-App (có thể kẻ tấn công đang xem màn hình).
3. Template đặc biệt: Cảnh báo đăng nhập lạ, link "Nếu không phải bạn, hãy đổi mật khẩu ngay".

---

### 2.9. `permission.changed`

**Trigger**: IAM Module phát khi Admin thay đổi Role/Permission của nhân viên.

**Payload**:
```typescript
{
  affectedUserId: string,
  affectedUserEmail: string,
  changedBy: string,    // Admin name
  changeType: 'ROLE_CHANGED' | 'PERMISSION_GRANTED' | 'PERMISSION_REVOKED',
  detail: string,       // VD: "Được nâng lên vai trò MANAGER"
}
```

**Logic xử lý**:
1. In-App + Email cho nhân viên bị ảnh hưởng.
2. Content: `"Quyền hạn của bạn trong hệ thống đã được Admin thay đổi: {{detail}}"`.

---

### 2.10. `auth.user_created`

**Trigger**: IAM Module phát khi Admin tạo tài khoản nhân viên mới thành công.

**Payload**:
```typescript
{
  userId: string,
  userEmail: string,
  userName: string,
  activationToken: string,
  expireAt: Date,
}
```

**Logic xử lý**:
1. Tier: **TRANSACTIONAL**.
2. Gửi **Email Chào Mừng & Thiết Lập Tài Khoản** (Email-only, không có thông báo In-App vì người dùng chưa thể đăng nhập).
3. Tạo link thiết lập mật khẩu: `https://portal.solavie.vn/activate-account?token={{activationToken}}&email={{userEmail}}`.
4. Render Handlebars template `auth.user_created` (Email) chứa link thiết lập mật khẩu và hướng dẫn kích hoạt tài khoản.
5. Gửi Email thông qua AWS SES/SMTP Provider.

---

### 2.11. `auth.password_changed`

**Trigger**: IAM Module phát khi nhân viên tự đổi mật khẩu thành công.

**Payload**:
```typescript
{
  userId: string,
  userEmail: string,
  ipAddress: string,
  userAgent: string,
  changedAt: Date,
}
```

**Logic xử lý**:
1. Tier: **TRANSACTIONAL**.
2. Gửi **Email Cảnh Báo Bảo Mật Đổi Mật Khẩu** (Email-only).
3. Render Handlebars template `auth.password_changed` (Email) chứa thông tin thời gian đổi mật khẩu (`changedAt`), địa chỉ IP (`ipAddress`), thông tin thiết bị (`userAgent`) và hướng dẫn bảo mật khẩn cấp nếu tài khoản bị xâm nhập ngoài ý muốn.
4. Gửi Email thông qua AWS SES/SMTP Provider.

---

## 3. Idempotency Logic

```typescript
// notification/services/idempotency.service.ts

generateKey(eventType: string, entityId: string, recipientId: string, channel: string): string {
  const raw = `${eventType}:${entityId}:${recipientId}:${channel}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async isDuplicate(key: string): Promise<boolean> {
  const existing = await this.notificationLogRepo.findOne({
    where: { idempotency_key: key, status: 'SENT' }
  });
  return !!existing;
}
```

---

## 4. Template Engine Logic

```typescript
// notification/services/template-engine.service.ts

async render(eventType: string, channel: 'email' | 'zalo' | 'in_app', context: Record<string, unknown>, language = 'vi'): Promise<{ subject?: string; body: string; zaloTemplateId?: string }> {
  const template = await this.templateRepo.findOne({
    where: { event_type: eventType, channel, language, is_active: true }
  });

  if (!template) {
    throw new TemplateNotFoundException(`No template for ${eventType}:${channel}:${language}`);
  }

  // Render Handlebars
  const compiledBody = Handlebars.compile(template.body_template);
  const body = compiledBody(context);

  const compiledSubject = template.subject ? Handlebars.compile(template.subject) : null;
  const subject = compiledSubject ? compiledSubject(context) : undefined;

  return { subject, body, zaloTemplateId: template.zalo_template_id };
}
```

---

## 5. Error Handling & DLQ Strategy

| Tình huống | Hành động |
|-----------|-----------|
| Provider throw exception | BullMQ retry với exponential backoff (5s, 10s, 20s) |
| Hết 3 lần retry | Job chuyển vào Dead-Letter Queue, log status='FAILED' |
| Template không tìm thấy | Log ERROR + status='FAILED', không retry |
| Zalo ZNS lỗi NO_ZALO_USER_ID | Fallback sang Email (nếu có), log skip_reason='ZALO_FALLBACK_EMAIL' |
| Socket.io user offline | Log status='SKIPPED', skip_reason='USER_OFFLINE' |
| Idempotency duplicate | Log status='SKIPPED', skip_reason='IDEMPOTENT' |
| Quiet Hours vi phạm | Log status='SKIPPED', skip_reason='QUIET_HOURS' |
