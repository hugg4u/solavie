# Solavie Platform — System Events Registry

| Tài liệu | System Events Registry |
|---|---|
| Phiên bản | 1.0.0 |
| Ngày tạo | 2026-06-16 |

> **Nguyên tắc:** Đây là tài liệu "hợp đồng" (Contract) giữa các module. Mọi thay đổi về event name, payload structure phải được cập nhật tại đây trước khi chỉnh sửa code.

---

## 1. Quy Chuẩn Đặt Tên Event & Idempotency Key

> **BẮT BUỘC (Idempotency):** Tất cả event payload được liệt kê dưới đây đều PHẢI chứa một trường `eventId: string` (thường là UUID v4). Các module (như CRM, Booking) khi nhận sự kiện từ Event Bus hoặc BullMQ phải lưu `eventId` này vào DB hoặc Redis để check trùng lặp (Dedup). Tuyệt đối không xử lý 2 lần với cùng một `eventId` để tránh rủi ro Duplicate Data.

```
{domain}.{entity}.{action}

Ví dụ:
  auth.user_created
  lead.score_hot
  appointment.confirmed
  chat.handover_requested
```

---

## 2. Event Registry Chi Tiết

### 2.1. Domain: `message` — Tin Nhắn Đến

#### `message.received`
| Field | Value |
|---|---|
| **Producer** | Gateway Module |
| **Consumers** | Chatbot Module, Inbox Module |
| **Delivery** | NestJS EventEmitter / Redis Pub/Sub |
| **Priority** | Tier 1 — CRITICAL |

**Payload:**
```typescript
{
  eventId: string;           // UUIDv4 để module nhận check Idempotency
  channel: 'FACEBOOK' | 'ZALO';
  senderId: string;          // PSID hoặc Zalo User ID
  conversationId: string;    // ID phiên hội thoại
  messageId: string;         // ID tin nhắn gốc từ đối tác
  content: string;           // Nội dung tin nhắn (đã masking PII)
  rawPayload: object;        // Webhook payload thô (để Inbox hiển thị đầy đủ)
  receivedAt: string;        // ISO8601
}
```

---

### 2.2. Domain: `chat` — Hội Thoại AI

#### `chat.handover_requested`
| Field | Value |
|---|---|
| **Producer** | Chatbot Module |
| **Consumers** | Inbox Module, Notification Module |
| **Trigger** | AI gặp 2 lần OOD fallback liên tiếp, hoặc khách hàng yêu cầu gặp người |
| **Priority** | Tier 1 — CRITICAL |

**Payload:**
```typescript
{
  eventId: string;
  conversationId: string;
  customerId: string | null;
  channel: 'FACEBOOK' | 'ZALO';
  senderId: string;
  reason: 'OOD_FALLBACK' | 'CUSTOMER_REQUESTED' | 'AGENT_INTERVENTION';
  handoverAt: string;        // ISO8601
}
```

---

### 2.3. Domain: `lead` — Khách Hàng Tiềm Năng

#### `lead.extracted`
| Field | Value |
|---|---|
| **Producer** | Chatbot Module |
| **Consumers** | CRM Module |
| **Trigger** | AI xác định đủ thông tin cơ bản để tạo/cập nhật Lead |

**Payload:**
```typescript
{
  eventId: string;
  conversationId: string;
  channel: 'FACEBOOK' | 'ZALO';
  senderId: string;
  extractedData: {
    fullName?: string;
    phoneNumber?: string;       // Masked trong log, rõ trong payload nội bộ
    email?: string;
    location?: string;
    monthlyBill?: number;       // VNĐ
    roofArea?: number;          // m²
    installationNeed?: string;
  };
  extractedAt: string;
}
```

#### `lead.assigned`
| Field | Value |
|---|---|
| **Producer** | CRM Module |
| **Consumers** | Notification Module |
| **Trigger** | Lead được gán Sales phụ trách (thủ công hoặc Round-Robin) |

**Payload:**
```typescript
{
  eventId: string;
  leadId: string;
  customerId: string;
  customerName: string;
  assigneeId: string;          // userId của Sales được gán
  assigneeEmail: string;
  assignedBy: string | 'SYSTEM';
  assignedAt: string;
}
```

#### `lead.score_hot`
| Field | Value |
|---|---|
| **Producer** | CRM Module |
| **Consumers** | Notification Module |
| **Trigger** | Lead score vượt ngưỡng HOT (configurable) |

**Payload:**
```typescript
{
  eventId: string;
  leadId: string;
  customerId: string;
  customerName: string;
  leadScore: number;
  leadTemperature: 'HOT';
  assigneeId: string;
  assigneeEmail: string;
  roiEstimation: {
    recommendedCapacity: number;   // kWp
    monthlyProduction: number;     // kWh
    monthlySavings: number;        // VNĐ
    paybackPeriodYears: number;
  };
  triggeredAt: string;
}
```

---

### 2.4. Domain: `appointment` — Lịch Hẹn

#### `appointment.confirmed`
| Field | Value |
|---|---|
| **Producer** | Booking Module |
| **Consumers** | CRM Module, Notification Module |
| **Priority** | Tier 2 — TRANSACTIONAL |

**Payload:**
```typescript
{
  eventId: string;
  appointmentId: string;
  eventTypeId: string;
  eventTypeTitle: string;
  hostId: string;              // Sales phụ trách
  hostEmail: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;       // Masked trong log
  startTime: string;           // ISO8601
  endTime: string;
  locationType: 'ONLINE_MEETING' | 'ONSITE_CUSTOMER' | 'OFFICE';
  meetingLink?: string;
  confirmedAt: string;
}
```

#### `appointment.cancelled`
| Field | Value |
|---|---|
| **Producer** | Booking Module |
| **Consumers** | CRM Module, Notification Module |

**Payload:**
```typescript
{
  eventId: string;
  appointmentId: string;
  hostId: string;
  hostEmail: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  originalStartTime: string;
  cancelledBy: 'CUSTOMER' | 'STAFF' | 'SYSTEM';
  cancelledAt: string;
  reason?: string;
}
```

#### `appointment.reminder`
| Field | Value |
|---|---|
| **Producer** | Booking Module (Cron Job) |
| **Consumers** | Notification Module |
| **Priority** | Tier 3 — SCHEDULED |

**Payload:**
```typescript
{
  eventId: string;
  appointmentId: string;
  hostId: string;
  hostEmail: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  startTime: string;
  reminderType: '24H_BEFORE' | '1H_BEFORE';
}
```

---

### 2.5. Domain: `inbox` — Hộp Thư Nhân Viên

#### `inbox.agent_mentioned`
| Field | Value |
|---|---|
| **Producer** | Inbox Module |
| **Consumers** | Notification Module |
| **Trigger** | Nhân viên được `@mention` trong comment nội bộ |
| **Priority** | Tier 1 — CRITICAL |

**Payload:**
```typescript
{
  eventId: string;
  commentId: string;
  conversationId: string;
  mentionedByUserId: string;
  mentionedByUserName: string;
  mentionedUserId: string;
  mentionedUserEmail: string;
  commentContent: string;       // Nội dung đầy đủ (đã loại bỏ mention tag)
  mentionedAt: string;
}
```

---

### 2.6. Domain: `auth` — Xác Thực & Bảo Mật

#### `auth.user_created`
| Field | Value |
|---|---|
| **Producer** | IAM Module |
| **Consumers** | Notification Module |
| **Trigger** | Admin tạo nhân viên mới, hoặc Admin yêu cầu gửi lại link kích hoạt |

**Payload:**
```typescript
{
  eventId: string;
  userId: string;
  userEmail: string;
  userName: string;
  activationToken: string;      // rawToken — Notification dùng để build link, KHÔNG LOG
  expireAt: string;             // ISO8601 — Sau 24h
}
```

#### `auth.login_new_device`
| Field | Value |
|---|---|
| **Producer** | IAM Module |
| **Consumers** | Notification Module |
| **Trigger** | Đăng nhập từ IP/User-Agent chưa từng xuất hiện |

**Payload:**
```typescript
{
  eventId: string;
  userId: string;
  userEmail: string;
  deviceInfo: string;           // Parsed User-Agent string
  ipAddress: string;
  loginTime: string;            // ISO8601
}
```

#### `auth.password_changed`
| Field | Value |
|---|---|
| **Producer** | IAM Module |
| **Consumers** | Notification Module |
| **Trigger** | Nhân viên tự đổi mật khẩu thành công |

**Payload:**
```typescript
{
  eventId: string;
  userId: string;
  userEmail: string;
  ipAddress: string;
  userAgent: string;
  changedAt: string;            // ISO8601
}
```

#### `permission.changed`
| Field | Value |
|---|---|
| **Producer** | IAM Module |
| **Consumers** | Notification Module |
| **Trigger** | Admin thay đổi Role hoặc Permission của nhân viên |

**Payload:**
```typescript
{
  eventId: string;
  affectedUserId: string;
  affectedUserEmail: string;
  changedBy: string;            // Admin userId
  changeType: 'ROLE_ASSIGN' | 'ROLE_REMOVE' | 'PERMISSION_GRANT' | 'PERMISSION_REVOKE';
  detail: string;               // Mô tả thay đổi (VD: "Vai trò SALES → MANAGER")
  changedAt: string;
}
```

---

### 2.7. Domain: `llm` — AI Cost Tracking

#### `llm.metrics.created`
| Field | Value |
|---|---|
| **Producer** | Chatbot Module / Gateway |
| **Consumers** | Gateway Background Worker (DB write + Log) |
| **Delivery** | NestJS EventEmitter (InMemory — không cần Pub/Sub) |

**Payload:**
```typescript
{
  eventId: string;
  conversationId: string | null;
  usecaseKey: string;           // 'AGENT_CHAT', 'QUERY_REWRITE', ...
  providerId: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  latencyMs: number;
  createdAt: string;
}
```

---

### 2.8. Domain: `gateway` — Quản Lý Hạ Tầng AI

#### `gateway.provider_failed`
| Field | Value |
|---|---|
| **Producer** | Gateway Module |
| **Consumers** | Notification Module |
| **Trigger** | API Key bị Out of credit, Rate Limit, hoặc cấu hình sai dẫn đến Failover. |
| **Priority** | Tier 1 — CRITICAL |

**Payload:**
```typescript
{
  eventId: string;
  providerId: string;
  providerName: string;
  modelName: string;
  errorReason: 'OUT_OF_CREDIT' | 'RATE_LIMIT' | 'CONNECTION_FAILED' | 'AUTH_ERROR';
  failedAt: string;
}
```

---

### 2.9. Domain: `storage` — Lưu Trữ File

#### `storage.image_processed`
| Field | Value |
|---|---|
| **Producer** | Storage Module (BullMQ Worker) |
| **Consumers** | CRM Module, IAM Module (Cập nhật avatar) |
| **Trigger** | Quá trình Async Image Optimization (Resize, WebP) hoàn tất |

**Payload:**
```typescript
{
  eventId: string;
  originalFileId: string;
  processedFileId: string;
  bucketName: string;
  processedObjectKey: string;
  processedSize: number;
  processedAt: string;
}
```

---

## 3. Mapping Event → Notification Channel

| Event | Recipient | Channel | Priority Tier |
|---|---|---|---|
| `auth.user_created` | Nhân viên mới | Email | Tier 2 |
| `auth.login_new_device` | Nhân viên đó | Email | Tier 2 |
| `auth.password_changed` | Nhân viên đó | Email | Tier 2 |
| `permission.changed` | Nhân viên bị ảnh hưởng | In-App + Email | Tier 1 + Tier 2 |
| `lead.assigned` | Sales được gán | In-App | Tier 1 |
| `lead.score_hot` | Sales phụ trách | In-App | Tier 1 |
| `chat.handover_requested` | Sales trực | In-App | Tier 1 |
| `inbox.agent_mentioned` | Sales được mention | In-App | Tier 1 |
| `appointment.confirmed` | Sales + Khách hàng | Email + Zalo ZNS | Tier 2 |
| `appointment.cancelled` | Sales + Khách hàng | Email + Zalo ZNS | Tier 2 |
| `appointment.reminder` | Khách hàng | Zalo ZNS / Email | Tier 3 |
| `gateway.provider_failed`| IT Admin | In-App + Email | Tier 1 |
