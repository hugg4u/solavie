# Solavie Platform — System Overview Specification

| Tài liệu | System Overview Specification |
|---|---|
| Dự án | Hệ thống AI Chatbot kết hợp CRM & O&M cho Năng lượng mặt trời Solavie |
| Phiên bản | 1.0.0 |
| Ngày tạo | 2026-06-16 |
| Trạng thái | Active |

---

## 1. Tổng Quan Hệ Thống

**Solavie Platform (Phase 1)** là hệ thống tự động hóa bán hàng và chăm sóc khách hàng ngành năng lượng mặt trời. Hệ thống tích hợp AI Chatbot đa kênh (Facebook, Zalo), CRM chuyên biệt Solar, và cơ chế phân quyền nhân viên nội bộ.

### Mục tiêu kinh doanh:
- Tự động hoá tiếp nhận & phân loại khách hàng tiềm năng từ mạng xã hội qua AI RAG
- Trích xuất nhu cầu Solar và tính toán ROI tự động
- Cung cấp giao diện inbox tập trung cho nhân viên Sales
- Quản lý lịch hẹn tư vấn và tích hợp Google Calendar

---

## 2. Danh Sách Modules & Bounded Contexts

| Module | Vai trò | Thư mục Spec | DB Prefix |
|---|---|---|---|
| **Gateway** | Webhook đa kênh, `ZaloTokenSyncWorker` refresh token, model routing, và chính sách 24h | `specs/gateway/` | `gw_` |
| **Chatbot** | Orchestrator AI RAG/ReAct, **Sub-modules: Flows Engine (luồng tự do), Keywords, Sequences, QR/Ref Growth Tools, Broadcasting Engine** | `specs/chatbot/` | `chat_` |
| **CRM** | Hồ sơ Lead/Customer, Solar ROI Calculator, **Sub-module: MergeProfileService (gộp trùng SĐT)** | `specs/crm/` | `crm_` |
| **IAM** | Xác thực JWT Rotation, phân quyền dynamic RBAC+ABAC, Audit Log | `specs/iam/` | `iam_` |
| **Inbox** | Unified Inbox, WebSockets, nhãn cảnh báo 24h, mẫu tin đính tag, comments | `specs/inbox/` | `inbox_` |
| **Booking** | Event Types, availabilities, Round-Robin Host, sync GCal | `specs/booking/` | `booking_` |
| **Notification** | Event consumer, gửi In-App, Email AWS SES, Zalo ZNS | `specs/notification/` | `notif_` |
| **Storage** | MinIO file storage, Pre-signed URL, Garbage Collector | `specs/storage/` | `storage_` |
| **DevOps** | Docker Compose, Redis isolation (6379 vs 6380), Grafana Loki | `specs/devops/` | — |

---

## 3. Nguyên Tắc Kiến Trúc (Architecture Principles)

### 3.1. Modular Monolith — Microservices-Ready
- Kiến trúc hiện tại: **Modular Monolith** (NestJS single process)
- Thiết kế sẵn sàng tách thành Microservices Phase 2 mà **không cần viết lại Business Logic**
- Nguyên tắc: mỗi module là một Bounded Context độc lập

### 3.2. Database Isolation — Cô Lập Dữ Liệu Tuyệt Đối
- **KHÔNG JOIN chéo** giữa bảng của các module khác nhau
- **KHÔNG dùng Foreign Key cứng** giữa module — sử dụng Soft Link (UUID reference)
- Mỗi module chỉ đọc/ghi bảng do chính module đó sở hữu
- Khi cần dữ liệu từ module khác: gọi qua **Internal Service API** hoặc **Event Bus**

### 3.3. Event-Driven Architecture (Transactional Outbox Pattern)
- Mọi tương tác phát sinh sự kiện (Publish Events) **bắt buộc** phải sử dụng **Hybrid Outbox Pattern** để chống mất mát dữ liệu (Dual-Write Problem).
- Khi ghi dữ liệu vào CSDL, module phải ghi sự kiện vào bảng Outbox tương ứng (Kế thừa từ `BaseOutboxEntity` ở Core) trong cùng một DB Transaction. 
- Hệ thống áp dụng 2 luồng: 
  - **Luồng Real-time:** Đẩy Job vào Queue (BullMQ) ngay sau khi Transaction commit để xử lý ngay lập tức (Status: PROCESSING -> PROCESSED).
  - **Luồng Sweeper:** Một Sweeper Cronjob định kỳ quét các event bị kẹt (PENDING) bằng Database Row-Level Lock (`SKIP LOCKED`) để đẩy bù vào Queue.
- Phase 1: **NestJS EventEmitter** (InMemory) cho events nội bộ đồng bộ
- Phase 1: **Redis Pub/Sub** hoặc **BullMQ** cho events bất đồng bộ cross-module từ Outbox
- Phase 2 (Microservices): Thay thế bằng **RabbitMQ / Kafka** mà không cần refactor logic
- Module Notification là **pure event consumer** — không bao giờ truy vấn DB của module khác

### 3.4. Clean Architecture bên trong mỗi Module
```
Controller/Resolver    ← HTTP/WS/Webhook handlers
      ↓
Service/Domain Logic   ← Business logic thuần túy (framework-agnostic)
      ↓
Repository/Infra       ← DB access, Redis, External APIs
```

### 3.5. Security-First Architecture
- Mọi API Key, Channel Token lưu DB phải được mã hóa **AES-256-GCM**
- Mật khẩu người dùng băm bằng **Bcrypt (saltRounds=10)**
- Token activation **lưu dưới dạng SHA256 hash** trong Redis — không lưu raw token
- Dữ liệu nhạy cảm (SĐT, Email) phải **Data Masking** trước khi gửi ra LLM API ngoài
- Access Token lưu trong **Memory** (không localStorage). Refresh Token trong **HttpOnly Cookie**

### 3.6. Cơ Chế Phân Phối Tin Nhắn Đầu Vào & Định Tuyến Tự Động
Khi Gateway nhận tin nhắn từ Facebook/Zalo Webhook:
1.  **Incoming Event Outbox:** Webhook payload được lưu vào bảng `gw_incoming_events` dạng `PENDING` để bảo vệ dữ liệu trước khi xử lý.
2.  **Keyword Matching Stage:** Tin nhắn được kiểm tra qua `KeywordRouterService`. Nếu khớp từ khóa cấu hình trong bảng `chat_keywords`, hệ thống khóa `bot_state` của cuộc trò chuyện thành `FLOW_EXECUTING` và khởi chạy kịch bản luồng tương ứng (`FlowExecutorService`).
3.  **Conversational State Routing:**
    -   Nếu `bot_state = MANUAL`: Bỏ qua tự động hóa, tin nhắn được chuyển thẳng lên màn hình Inbox cho nhân viên phản hồi thủ công.
    -   Nếu `bot_state = FLOW_EXECUTING`: Tin nhắn tiếp tục được đẩy vào `FlowExecutorService` để chạy các node tiếp theo. Nếu khách hàng nhập văn bản tự do lạc đề (không click button/carousel của kịch bản), động cơ sẽ tự giải phóng luồng, chuyển `bot_state = AUTOMATIC` để AI Agent can thiệp.
    -   Nếu `bot_state = AUTOMATIC`: Tin nhắn được phân tích bởi AI Agent (RAG Search + LLM Prompt) để tự động trả lời hoặc gọi các công cụ (Booking, ROI).
4.  **Handover Alert:** Nếu AI Agent 2 lần liên tiếp gặp lỗi hoặc không tìm thấy câu trả lời, hệ thống sẽ tự động gán cuộc chat sang `MANUAL`, gửi thông báo handover cho nhân viên và gửi câu trả lời lịch sự xin lỗi khách hàng.

---

## 4. Sơ Đồ Luồng Giao Tiếp (Inter-Module Communication)

```
[Facebook Webhook] ──→ Gateway → gw_incoming_events (Outbox) → BullMQ → Chatbot
[Zalo Webhook]     ──→ Gateway ────────────────────────────────────────→ Inbox

Chatbot ──→ [Event: lead.extracted]      ──→ CRM
        ──→ [Event: chat.handover]       ──→ Inbox → Notification
        ──→ [Tool Call: appointment]     ──→ Booking
        ──→ [LLM Request]               ──→ LiteLLM Proxy → AI Providers

CRM     ──→ [Event: lead.assigned]       ──→ Notification
        ──→ [Event: lead.score_hot]      ──→ Notification

IAM     ──→ [Event: auth.user_created]   ──→ Notification
        ──→ [Event: auth.password_changed] → Notification
        ──→ [Event: auth.login_new_device] → Notification
        ──→ [Event: permission.changed]  ──→ Notification

Booking ──→ [Event: appointment.confirmed] → CRM + Notification
        ──→ [Event: appointment.cancelled] → CRM + Notification

Notification ──→ In-App WebSocket → Admin Dashboard
             ──→ BullMQ Email Queue → AWS SES
             ──→ BullMQ Zalo Queue  → Zalo ZNS API
```

---

## 5. Redis Architecture — Cô Lập Vật Lý

| Instance | Port | Policy | Mục đích |
|---|---|---|---|
| `redis-cache` | 6379 | `allkeys-lru` | IAM Permission Cache, Typing Lock, Rate Limit, Session |
| `redis-queue` | 6380 | `noeviction` + AOF | BullMQ Job Queues, IAM Refresh Token, Activation Token |

> **Nguyên tắc bất di bất dịch:** Dữ liệu không được phép mất (token, job queue) → `redis-queue`. Dữ liệu có thể tái sinh (cache) → `redis-cache`.

### Phân bổ Redis Key theo module:

| Module | Instance | Key Pattern | TTL |
|---|---|---|---|
| IAM | Queue | `iam:refresh_token:${token}` | 7 ngày |
| IAM | Queue | `iam:activation:hash:${sha256}` | 24 giờ |
| IAM | Cache | `user:permissions:${userId}` | 1 giờ |
| Gateway | Cache | `gw:providers:configured` | 5 phút |
| Gateway | Cache | `cooldown:provider:${providerId}` | 15 phút |
| Gateway | Cache | `errors:provider:${providerId}` | 1 giờ |
| Chatbot | Cache | `lock:conversation:${conversationId}` | 30 giây |
| Chatbot | Cache | `buffer:conversation:${conversationId}` | 5 giây |
| CRM | Cache | `lock:merge:phone:${phone}` | 10 giây |
| Booking | Cache | `lock:booking:slot:${slotId}` | 5 phút |
| Inbox | Cache | `lock:typing:conversation:${id}` | 5 giây |

---

## 6. Logging Architecture — Grafana Loki

### Cấu trúc Log JSON chuẩn (áp dụng toàn hệ thống):
```json
{
  "timestamp": "ISO8601",
  "level": "debug|info|warn|error",
  "module": "IAM|CRM|CHATBOT|...",
  "context": "ServiceName hoặc MethodName",
  "message": "Mô tả sự kiện ngắn gọn",
  "traceId": "trace-id-từ-gateway",
  "metadata": { "...dữ liệu chi tiết..." }
}
```

### Quy tắc chung:
- **KHÔNG BAO GIỜ** ghi `password`, `password_hash`, raw `refreshToken`, raw `activationToken`, API Key, hay thẻ tín dụng vào log
- `traceId` phải được truyền xuyên suốt từ Gateway vào tất cả module con
- Promtail thu thập từ stdout → Loki → Grafana Dashboard
- Alert: Nếu `level=error` > 5 lần/phút → Gửi cảnh báo Telegram/Discord

---

## 7. Technology Stack

| Layer | Công nghệ | Phiên bản |
|---|---|---|
| **Backend Framework** | NestJS | v10+ |
| **Language** | TypeScript | v5+ |
| **Database** | PostgreSQL + pgvector | v16+ |
| **ORM** | TypeORM | latest stable |
| **Cache/Queue** | Redis | v7+ |
| **Job Queue** | BullMQ | latest stable |
| **File Storage** | MinIO | latest |
| **AI Gateway** | LiteLLM Proxy | latest |
| **AI SDK** | `@google/generative-ai` + `openai` | latest |
| **Auth** | JWT (HS256) + Bcrypt | — |
| **Email** | AWS SES / SMTP | — |
| **Logging** | Promtail + Grafana Loki | latest |
| **Monitoring** | Grafana | latest |
| **Container** | Docker + Docker Compose | — |

---

## 8. Danh Sách Events Toàn Hệ Thống (Global Event Registry)

| Event Name | Producer | Consumers | Mô tả |
|---|---|---|---|
| `message.received` | Gateway | Chatbot, Inbox | Tin nhắn mới từ FB/Zalo |
| `lead.extracted` | Chatbot | CRM, Notification | AI trích xuất thông tin lead |
| `chat.handover_requested` | Chatbot | Inbox, Notification | AI không xử lý được, chuyển Sales |
| `inbox.agent_mentioned` | Inbox | Notification | Sales được tag trong comment nội bộ |
| `lead.assigned` | CRM | Notification | Lead được gán cho Sales |
| `lead.score_hot` | CRM | Notification | Lead đạt ngưỡng HOT |
| `appointment.confirmed` | Booking | CRM, Notification | Lịch hẹn được xác nhận |
| `appointment.cancelled` | Booking | CRM, Notification | Lịch hẹn bị huỷ |
| `appointment.reminder` | Booking (Cron) | Notification | Nhắc nhở trước lịch hẹn |
| `auth.user_created` | IAM | Notification | Admin tạo nhân viên mới |
| `auth.login_new_device` | IAM | Notification | Đăng nhập thiết bị lạ |
| `auth.password_changed` | IAM | Notification | Đổi mật khẩu thành công |
| `permission.changed` | IAM | Notification | Thay đổi quyền nhân viên |
| `llm.metrics.created` | Chatbot/Gateway | Gateway (Background Worker) | Ghi nhận chi phí AI |
| `chat.flow.executed` | Chatbot | CRM, Notification, Inbox | Kích hoạt luồng kịch bản thành công |
| `chat.keyword.matched` | Chatbot | Inbox | Tin nhắn khớp từ khóa kích hoạt |
| `chat.sequence.subscribed`| Chatbot | CRM, Notification | Khách tham gia chuỗi chăm sóc |
| `chat.broadcast.campaign_created` | Chatbot | Notification | Chiến dịch gửi tin hàng loạt được tạo |
| `chat.broadcast.campaign_status_changed` | Chatbot | Notification, Inbox | Thay đổi trạng thái chiến dịch gửi tin |
| `crm.profile.merged` | CRM | Inbox, Notification | Hợp nhất hồ sơ trùng SĐT thành công |

---

## 9. Non-Functional Requirements (NFR) Toàn Hệ Thống

| Hạng mục | Yêu cầu |
|---|---|
| **Latency — IAM Guard** | < 2ms khi Redis cache hit |
| **Latency — AI First Token** | < 500ms (streaming SSE) |
| **Throughput — Webhook** | Xử lý được spike tin nhắn qua BullMQ queue |
| **Availability** | Redis Queue (noeviction + AOF) đảm bảo không mất job |
| **Security — Data Masking** | Mask SĐT/Email trước khi gửi ra LLM API |
| **Security — Token** | Activation token single-use, lưu SHA256 hash |
| **Security — API Keys** | Mã hóa AES-256-GCM tại DB |
| **Cost Control** | Prompt Caching tối thiểu 80% token tái sử dụng |
| **Observability** | 100% log có cấu trúc JSON + traceId |
| **Anti-Spam AI** | Hàng đợi conversation max 2 tin nhắn, reject nếu vượt |

---

## 10. File Index Specs

```
specs/
├── system_overview.md          ← File này — Tổng quan hệ thống
├── system_events.md            ← Event Registry chi tiết toàn hệ thống
├── system_redis_keys.md        ← Toàn bộ Redis key patterns
├── system_api_conventions.md   ← Quy chuẩn API response/error toàn hệ thống
├── system_outbox_pattern.md    ← Kiến trúc và khuôn mẫu Transactional Outbox Pattern
│
├── gateway/                    ← Module Gateway & LLM Routing
├── chatbot/                    ← Module AI Chatbot & RAG
├── crm/                        ← Module CRM & ROI Calculator
├── iam/                        ← Module IAM & Auth
├── inbox/                      ← Module Agent Inbox
├── booking/                    ← Module Booking
├── notification/               ← Module Notification
├── storage/                    ← Module Storage (MinIO)
└── devops/                     ← DevOps & Infrastructure
```
