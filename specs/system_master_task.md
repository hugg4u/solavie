# Solavie Platform — Master Task List (System-Level)

| Tài liệu | Master Task List — Toàn Hệ Thống |
|---|---|
| Phiên bản | 1.0.0 |
| Ngày tạo | 2026-06-16 |
| Cập nhật lần cuối | 2026-06-16 |

> **Hướng dẫn sử dụng:**
> - `[ ]` — Chưa bắt đầu
> - `[/]` — Đang thực hiện
> - `[x]` — Hoàn thành
> - `[-]` — Đã bỏ qua / Không áp dụng
>
> Mỗi task liên kết ngược về file task chi tiết của từng module. Cập nhật trạng thái tại **cả 2 nơi** (file này + file task module).

---

## 📊 TỔNG QUAN TIẾN ĐỘ

| Module | Phase | Tổng Tasks | ✅ Xong | 🔄 Đang | ❌ Chưa |
|---|---|---|---|---|---|
| **DevOps** | 5 phases | 17 | 0 | 0 | 17 |
| **IAM** | 4 phases | 24 | 0 | 0 | 24 |
| **Gateway** | — | 19 | 1 | 0 | 18 |
| **Chatbot** | 7 phases | 34 | 1 | 0 | 33 |
| **CRM** | 3 phases | 19 | 0 | 0 | 19 |
| **Inbox** | 5 phases | 14 | 0 | 0 | 14 |
| **Booking** | 6 phases | 22 | 0 | 0 | 22 |
| **Notification** | 4 phases | 30 | 5 | 0 | 25 |
| **Storage** | — | 5 | 1 | 0 | 4 |
| **System-Level** | 3 phases | 12 | 8 | 0 | 4 |
| **TỔNG CỘNG** | — | **190** | **16** | **0** | **174** |

---

## 🏗️ GIAI ĐOẠN 0: HẠ TẦNG & SPECS HỆ THỐNG

> *Phải hoàn thành TRƯỚC KHI viết bất kỳ dòng code nào.*

### 0.1 — Tài Liệu Specs Cấp Hệ Thống

- [x] **SYS-DOC-01:** Tạo `specs/system_overview.md` — Tổng quan platform, modules, nguyên tắc kiến trúc
- [x] **SYS-DOC-02:** Tạo `specs/system_events.md` — Global Event Registry (14 events + payload TypeScript)
- [x] **SYS-DOC-03:** Tạo `specs/system_api_conventions.md` — URL, HTTP, Error codes, Rate Limit
- [x] **SYS-DOC-04:** Tạo `specs/system_redis_keys.md` — Redis Key Registry toàn hệ thống
- [x] **SYS-DOC-05:** Tạo `specs/system_master_task.md` — File này (Master Task List)
- [x] **SYS-DOC-06:** Cập nhật `docs/architecture_design.md` — Thêm Notification Module vào diagram
- [x] **SYS-DOC-07:** Cập nhật `docs/database_schema.md` — Đã có 3 bảng notification (verify)
- [x] **SYS-DOC-08:** Tạo `specs/devops/logging.md` — Quy chuẩn Grafana Loki, Promtail config

### 0.2 — NestJS Project Bootstrap

- [x] **SYS-BOOT-01:** Khởi tạo NestJS project với Fastify adapter (`@nestjs/platform-fastify`)
- [x] **SYS-BOOT-02:** Cấu hình `ConfigModule` (global, validation schema với `zod`)
- [x] **SYS-BOOT-03:** Cấu hình `TypeORM` + PostgreSQL connection (pgvector enabled)
- [x] **SYS-BOOT-04:** Cấu hình `RedisModule` multi-client: namespace `cache` (6379) + `queue` (6380)
- [x] **SYS-BOOT-05:** Cấu hình `BullModule` global với `REDIS_QUEUE_URL` (noeviction instance)
- [x] **SYS-BOOT-06:** Cấu hình `EventEmitter2` module (global, wildcard enabled)
- [x] **SYS-BOOT-07:** Cấu hình Winston Logger (JSON stdout format, levels per env)
- [x] **SYS-BOOT-08:** Cấu hình Global `ValidationPipe`, `GlobalExceptionFilter`, `TraceIdInterceptor`
- [x] **SYS-BOOT-09:** Cài đặt và cấu hình Helmet, CORS (chỉ allow portal domain)
- [x] **SYS-BOOT-10:** Cài đặt Rate Limiter global (`@nestjs/throttler` + Redis store)
- [x] **SYS-BOOT-11:** Cài đặt Global Idempotency Guard/Interceptor (`eventId` checker) [Tham khảo Inbox Pattern Spec](system_inbox_pattern.md)
- [x] **SYS-BOOT-12:** Thiết lập kiến trúc Core Outbox (BaseOutboxEntity) và cấu hình BullMQ. [Tham khảo Outbox Spec](system_outbox_pattern.md)

---

## 🐳 GIAI ĐOẠN 1: DEVOPS & INFRASTRUCTURE

> **Ref:** [specs/devops/task.md](file:///d:/workspace/project/solavie/specs/devops/task.md)

### Phase 1: Dockerfile & Base Setup

- [x] **DEV-01:** Multi-stage `Dockerfile` (Stage 1: build TS → Stage 2: node-alpine production)
- [x] **DEV-02:** Cấu hình `.dockerignore` (loại bỏ `node_modules`, `dist`, logs)
- [x] **DEV-03:** Soạn `.env.example` đầy đủ (DB, Redis x2, MinIO, LiteLLM, JWT, AES Key, SMTP, Zalo)

### Phase 2: Docker Compose Orchestration

- [x] **DEV-04:** Service `postgres` (image `ankane/pgvector:v0.5.1`) + healthcheck `pg_isready`
- [x] **DEV-05:** Service `redis-cache` (port 6379, `allkeys-lru`, 512MB) + healthcheck
- [x] **DEV-06:** Service `redis-queue` (port 6380, `noeviction`, `appendonly yes`, 1GB) + healthcheck
- [x] **DEV-07:** Service `minio` (port 9000 API, 9001 Console) + healthcheck
- [x] **DEV-08:** Service `litellm` (AI proxy) + healthcheck
- [x] **DEV-09:** Service `mailhog` (development SMTP preview, port 8025 UI)
- [x] **DEV-10:** `depends_on` với `service_healthy` cho NestJS backend

### Phase 3: Persistence & Init

- [x] **DEV-11:** Persistent volumes cho `pg_data`, `minio_data`, `redis_cache_data`, `redis_queue_data`
- [x] **DEV-12:** MinIO auto-bucket creation script (4 buckets: `rag-documents`, `customer-media`, `user-media`, `system-assets`)

### Phase 4: Notification Env Setup

- [x] **DEV-13:** Thêm Email env vars vào `.env.example`: `SMTP_*`, `AWS_SES_*`, `NOTIFICATION_FROM_*`
- [x] **DEV-14:** Thêm Zalo env vars: `ZALO_OA_ID`, `ZALO_OA_ACCESS_TOKEN`, `ZALO_ZNS_SECRET_KEY`
- [x] **DEV-15:** `ConfigModule` validation throw error nếu thiếu biến bắt buộc

### Phase 5: Security & Hardening

- [x] **DEV-16:** Dockerfile Stage 2 sử dụng `USER node` (non-root)
- [x] **DEV-17:** Kiểm tra production image size < 150MB

---

## 🔐 GIAI ĐOẠN 2: MODULE IAM (Identity & Access Management)

> **Ref:** [specs/iam/task.md](file:///d:/workspace/project/solavie/specs/iam/task.md) | [specs/iam/design.md](file:///d:/workspace/project/solavie/specs/iam/design.md)
>
> ⚠️ **IAM phải hoàn thành Phase 1 trước khi bất kỳ module nào dùng Guard/Decorator.**

### Phase 1: Core Auth & Permission Engine

- `[x]` **IAM-01:** `AuthService` — login, Bcrypt verify, JWT access token (15m), Refresh Token (32 bytes random, Redis `iam:refresh_token:${token}`, TTL 7d)
- `[x]` **IAM-02:** HttpOnly Cookie config cho `/login` và `/refresh` (Secure, SameSite=Strict)
- `[x]` **IAM-03:** Refresh Token Rotation — thu hồi cũ, phát mới, Breach Detection (replay attack → revoke all sessions)
- `[x]` **IAM-04:** `POST /api/v1/iam/auth/logout` — xóa Redis key, clear cookie, xóa permission cache
- `[x]` **IAM-05:** JWT Strategy (Passport) — validate `Authorization: Bearer <token>`
- `[x]` **IAM-06:** `@RequirePermissions()` decorator + `PermissionsGuard`
- `[x]` **IAM-07:** Dynamic Policy Engine (ABAC) — eval biểu thức từ `iam_policies` (VD: `user.id == resource.assignee_id`)
- `[x]` **IAM-08:** Audit Interceptor — tự động ghi `iam_role_audit_logs` khi có thay đổi ghi/sửa
- `[x]` **IAM-09:** Permission Cache — `user:permissions:${userId}` (Redis `cache`, TTL 1h) + invalidation khi thay đổi quyền
- `[x]` **IAM-10:** Brute-force protection — đếm sai/IP (`iam:brute_force:${ip}`), khóa 15p sau 10 lần sai

### Phase 2: Security Event Notification Integration

- `[x]` **IAM-11:** Event DTOs: `LoginNewDeviceEvent`, `PermissionChangedEvent`, `UserCreatedEvent`, `PasswordChangedEvent`
- `[x]` **IAM-12:** Device Fingerprint Detection — so sánh `(ip, user-agent)` → emit `auth.login_new_device`
- `[x]` **IAM-13:** `emit('auth.login_new_device', payload)` (qua Outbox) trong `AuthService.login()` [Tham khảo Outbox Spec](system_outbox_pattern.md)
- `[x]` **IAM-14:** Ghi `iam_outbox_events` + cache invalidate trong `RoleService/PermissionService` sau DB update [Tham khảo Outbox Spec](system_outbox_pattern.md)
- `[x]` **IAM-15:** IAM Outbox Sweeper — Cronjob quét `iam_outbox_events` PENDING (dùng `SKIP LOCKED`) và push bù vào BullMQ. [Tham khảo Outbox Spec](system_outbox_pattern.md)
- `[x]` **IAM-16:** Integration tests: login mới → emit event; thay đổi role → cache xóa + emit event; login thiết bị cũ → không emit

### Phase 3: Profile & Password Settings

- `[x]` **IAM-16:** `PATCH /api/v1/iam/users/me/profile` — cập nhật `full_name`, `avatar_url` (validate domain `user-media` bucket)
- `[x]` **IAM-17:** `POST /api/v1/iam/users/me/change-password` — verify `oldPassword` Bcrypt, hash new, revoke all sessions + cache
- `[x]` **IAM-18:** `emit('auth.password_changed', payload)` sau đổi mật khẩu thành công
- `[x]` **IAM-19:** Unit & Integration tests: profile update, đổi mật khẩu, revoke sessions

### Phase 4: User Management & Activation Flow

- `[x]` **IAM-20:** Admin APIs: `POST /api/v1/iam/users`, `GET /api/v1/iam/users` (phân trang), `PATCH /api/v1/iam/users/:id`
- `[x]` **IAM-21:** Activation Token — sinh 32 bytes random, lưu `SHA256(token)` vào Redis `iam:activation:hash:${sha256}` (TTL 24h)
- `[x]` **IAM-22:** `emit('auth.user_created', payload)` kèm `activationToken` (rawToken — Notification dùng để build URL)
- `[x]` **IAM-23:** `POST /api/v1/iam/auth/exchange-activation-token` — verify hash, xóa Redis (single-use), sinh SetupJWT (5m) → HttpOnly cookie
- `[x]` **IAM-24:** `POST /api/v1/iam/auth/activate` — decode SetupJWT cookie, hash mật khẩu, set `is_active=true`
- `[x]` **IAM-25:** `POST /api/v1/iam/users/:id/resend-activation` — Admin gửi lại link
- `[x]` **IAM-26:** E2E tests: full activation flow, single-use token, link lần 2 báo lỗi 400

---

## 🌐 GIAI ĐOẠN 3: MODULE GATEWAY

> **Ref:** [specs/gateway/task.md](file:///d:/workspace/project/solavie/specs/gateway/task.md)
>
> ⚠️ **Gateway phải hoàn thành trước khi Chatbot và Inbox hoạt động.**

- [x] **GW-01:** Fastify adapter setup (NestJS platform-fastify)
- [x] **GW-02:** Channel Configuration API — quản lý cấu hình FB/Zalo (lưu AES-256-GCM encrypted)
- [x] **GW-03:** Signature Middleware — verify HMAC-SHA256 Facebook webhook
- [x] **GW-04:** Zalo OA Signature Middleware — verify Zalo webhook signature
- [x] **GW-05:** Parser & Mapper — transform FB/Zalo JSON → `UnifiedMessage` interface
- [x] **GW-06:** BullMQ Integration — setup kết nối `REDIS_QUEUE_URL`
- [x] **GW-07:** BullMQ Producer — đẩy `UnifiedMessage` vào queue, HTTP 200 < 200ms
- [x] **GW-08:** Migration + Entity `gw_incoming_events` (Outbox pattern) [Tham khảo Outbox Spec](system_outbox_pattern.md)
- [x] **GW-09:** Hybrid Outbox Logic — DB Transaction nhận webhook + save outbox + push queue ngay lập tức. [Tham khảo Outbox Spec](system_outbox_pattern.md)
- [x] **GW-10:** `GatewayCryptoService` — AES-256-GCM encrypt/decrypt API keys
- [x] **GW-11:** Redis Isolation Config — `REDIS_CACHE_URL` + `REDIS_QUEUE_URL` (→ DevOps task DEV-05/06)
- [x] **GW-12:** Background Recovery Worker — `@Interval` scan `gw_incoming_events` status `PENDING` → retry
- [x] **GW-13:** BullMQ shared connection config (default job options: attempts=3, backoff exponential)
- [x] **GW-14:** `GET /api/v1/gateway/providers/supported` — danh sách LLM hãng tĩnh + cache group
- [x] **GW-15:** `GET /api/v1/gateway/providers/configured` — query DB, mask API keys, Redis cache 300s
- [x] **GW-16:** Provider cache invalidation khi Admin cập nhật
- [x] **GW-17:** Migration + Entity `gw_prompt_variables`
- [x] **GW-18:** Prompt Variables CRUD — `POST`/`GET /api/v1/gateway/prompts/variables` (guard `prompt:write`/`prompt:read`)
- [x] **GW-19:** Prompt Injection Filter — regex blacklist kiểm duyệt đầu vào
- [x] **GW-20:** Prompt Variables Redis cache 300s + invalidation
- [ ] **GW-21:** Zalo OA Token Refresh — `ZaloTokenSyncWorker` chạy ngầm làm mới access token mỗi 20 giờ
- [ ] **GW-22:** Webhook Carousel Parser — hỗ trợ parse Facebook Carousel và Zalo List Message gửi về
- [ ] **GW-23:** Comment Automation Service — ẩn comment có SĐT (Regex), auto-reply và inbox khách
- [ ] **GW-24:** Growth Link Webhook Parser — bóc tách tham số `referral.ref` hoặc QR Code param chuyển tiếp vào Chatbot
- [ ] **GW-25:** Interaction Window Guard — tự động chặn gửi tin ngoài cửa sổ tương tác (FB/Zalo 24h) nếu không đính kèm Message Tag hợp lệ (`CONFIRMED_EVENT_UPDATE` hoặc `HUMAN_AGENT`)

---

## 🤖 GIAI ĐOẠN 4: MODULE CHATBOT & AI CORE

> **Ref:** [specs/chatbot/task.md](file:///d:/workspace/project/solavie/specs/chatbot/task.md)
>
> ⚠️ **Phụ thuộc: Gateway (GW-01 → GW-13) phải hoàn thành trước.**

### Phase 1: Setup Infrastructure & Base LLM Engine

- [ ] **CB-01:** Database setup: migrate `gw_llm_providers`, `gw_llm_provider_models`, `gw_llm_usecases`, `gw_llm_metrics`, thêm cột followup vào `chat_conversations`
- [x] **CB-02:** LiteLLM container (→ DevOps task DEV-08)
- [ ] **CB-03:** `BaseLLMAdapter` interface definition
- [ ] **CB-04:** OpenAI Compatible Client — adapter kết nối LiteLLM, nạp API Key động từ header
- [ ] **CB-05:** Lazy Load Registry/Factory — load và cache adapter instances
- [ ] **CB-06:** Dynamic Router & Failover Interceptor — định tuyến theo priority, catch `insufficient_quota` → `OUT_OF_CREDIT` → failover
- [ ] **CB-07:** Async Metrics Logger — `@OnEvent('llm.metrics.created')` tính cost (cached token discount) + insert `gw_llm_metrics`

### Phase 2: RAG Pipeline (Hierarchical & Hybrid)

- [ ] **CB-08:** TypeORM/pgvector integration cho kiểu `vector`
- [ ] **CB-09:** Hierarchical Chunking Script — PDF/MD → Parent (1000 tokens) + Child (200 tokens, 50 overlap) → `rag_documents`
- [ ] **CB-10:** PostgreSQL FTS — generated column `tsv_content`, GIN index, rewrite search function
- [ ] **CB-11:** Query Rewriter & Classifier — LLM phụ JSON Mode: rewrite query + classify `is_in_domain`
- [ ] **CB-12:** OOD Filter Service — Regex static + dynamic Classifier, auto-reply từ template tĩnh
- [ ] **CB-13:** Reranker Client — HTTP client đến Cohere/TEI reranker API
- [ ] **CB-14:** Hybrid Retrieval + RRF — Vector Search + FTS + Reciprocal Rank Fusion (k=60), fetch Parent Chunk

### Phase 3: ReAct Agent & Tool Integration

- [ ] **CB-15:** ReAct Agent Loop — Thought → Action → Observation (max 3 iterations)
- [ ] **CB-16:** Tool `crm_create_lead` — gọi CRM Module API
- [ ] **CB-17:** Tool `get_solar_knowledge` — gọi RAG Pipeline
- [ ] **CB-18:** Tool `get_booking_slots` — gọi Booking Module `AvailableSlotsService`
- [ ] **CB-19:** Tool `create_appointment` — gọi Booking Module `AppointmentService`

### Phase 4: Guardrails & Optimization

- [ ] **CB-20:** PII Masking Interceptor — Redact SĐT, Email, số thẻ khỏi prompt gửi ra LLM
- [ ] **CB-21:** Output Guardrail — lọc profanity, chặn stack trace, kiểm tra giá Solar với bảng giá
- [ ] **CB-22:** Hallucination Grounding Validator — LLM Judge chấm Faithfulness trước khi gửi
- [ ] **CB-23:** BullMQ Debounce Queue — `chatbot-debounce`, Redis List buffer, gộp tin 10s
- [ ] **CB-24:** Token Flood Protection — max 5 tin, cắt ở 2000 ký tự
- [ ] **CB-25:** BullMQ Follow-up Scheduler — nhắc khách sau 2h im lặng (LLM sinh nội dung hoặc alert Sales)
- [ ] **CB-26:** Quiet Hours Guard — hoãn gửi [22h-7h], reschedule 08h00
- [ ] **CB-27:** Circuit Breaker — đếm lỗi Redis, cooldown 15p sau 3 lần lỗi liên tiếp
- [ ] **CB-28:** Multi-Provider Prompt Caching — 4 nhóm cơ chế (APC, explicit flags, cachedContents, custom)
- [ ] **CB-29:** System Prompt Optimization — phần tĩnh đầu, vượt 1024 tokens
- [ ] **CB-30:** Migration thêm cột `customer_id` vào `chat_conversations`
- [ ] **CB-31:** `emit('chat.handover_requested', payload)` trong `ChatbotHandoverService.triggerHandover()`
- [ ] **CB-32:** Handover Message — gửi tin lịch sự cho khách ngay khi chuyển MANUAL
- [ ] **CB-33:** `POST /api/v1/chat/conversations/:id/handback` (guard `inbox.conversation.write`)
- [ ] **CB-34:** Flows CSDL Migration — khởi tạo cấu trúc CSDL cho `chat_flows` và `chat_nodes`
- [ ] **CB-35:** Graph Validator Service — kiểm duyệt cycle loop (DFS) và node mồ côi (BFS) trước khi lưu
- [ ] **CB-36:** Flows Admin REST APIs — `GET`/`POST`/`PUT`/`DELETE /api/v1/chatbot/flows`
- [ ] **CB-37:** Flow Executor Engine — `FlowExecutorService` duyệt cây JSON node, chạy các logic hành động và điều hướng node tiếp theo
- [ ] **CB-38:** Keywords Matcher Service — `KeywordRouterService` bắt từ khóa MATCH, CONTAINS, STARTS_WITH để kích hoạt kịch bản
- [ ] **CB-39:** Keywords Admin REST APIs — `GET`/`POST`/`DELETE /api/v1/chatbot/keywords`
- [ ] **CB-40:** Sequences CSDL Migration — khởi tạo cấu trúc cho `chat_sequences`, `chat_sequence_steps` và `chat_sequence_subscribers`
- [ ] **CB-41:** Sequence Scheduler Engine — `SequenceSchedulerService` sử dụng BullMQ delay queue (`solavie:chatbot-sequence`) để đẩy tin bám đuổi theo timeline
- [ ] **CB-42:** Growth Tools Generator — API sinh Ref URL và mã QR tương ứng gán `ref_parameter` trỏ tới kịch bản Flow
- [ ] **CB-43:** Broadcasting Database Migration — khởi tạo bảng `chat_broadcast_campaigns` và `chat_broadcast_logs`
- [ ] **CB-44:** Broadcasting Engine — `BroadcastService` lập danh sách, phân lô (50 khách) và tự động giãn cách gửi tin (FB 1s, Zalo 0.5s) qua BullMQ
- [ ] **CB-45:** Quiet Hours & Circuit Breaker — hoãn gửi tin ban đêm (22h-7h) và tự ngắt bảo vệ khi lỗi liên tiếp 20 tin, ghi Outbox cảnh báo IT Admin

### Phase 5: Centralized Logging, Sync & Monitoring

- [ ] **CB-34:** Winston JSON Logger stdout
- [ ] **CB-35:** Metrics tracking — token, cost, latency, RAG matching score vào log metadata
- [ ] **CB-36:** Models Sync Cron Job hàng ngày (LiteLLM `/public/litellm_model_cost_map` → upsert DB)
- [ ] **CB-37:** `POST /api/v1/gateway/models/sync` — Admin trigger manual sync
- [ ] **CB-38:** Cost Analytics APIs: `GET /api/v1/gateway/metrics/summary` + `/metrics/raw`

### Phase 6: Evals Engine

- [ ] **CB-39:** Migration + Entities `chat_eval_datasets`, `chat_eval_results`
- [ ] **CB-40:** Language Detector Service (offline npm, < 1ms)
- [ ] **CB-41:** i18n config — `vi.json`, `en.json`, `zh.json` cho system messages
- [ ] **CB-42:** `PromptInterpolationManager` — ghép System Prompt tĩnh + dynamic vars + language directive
- [ ] **CB-43:** LLMLingua-2 Client — nén RAG (0.4) + History (0.6) khi prompt > 3000 tokens
- [ ] **CB-44:** `EvalsService` — chạy simulation + LLM Judge chấm điểm NLI
- [ ] **CB-45:** `POST /api/v1/chatbot/evals/run` — Admin trigger evals

### Phase 7: Integration Tests

- [ ] **CB-46:** Handover Event Test — state=MANUAL, gửi tin lịch sự, emit đúng payload
- [ ] **CB-47:** No Duplicate Notification Test — Chatbot không bắn WebSocket trực tiếp

---

## 📋 GIAI ĐOẠN 5: MODULE CRM

> **Ref:** [specs/crm/task.md](file:///d:/workspace/project/solavie/specs/crm/task.md)
>
> ⚠️ **Phụ thuộc: IAM (Phase 1) + DevOps (Phase 1-3) hoàn thành.**

### Phase 1 & 2: Core CRM

- [ ] **CRM-01:** Entities + Migrations: `crm_customers`, `crm_stages`, `crm_field_definitions`, `crm_scoring_rules`, `crm_activities`
- [ ] **CRM-02:** Admin Config APIs — CRUD cho Fields, Stages, Rules
- [ ] **CRM-03:** Dynamic Pipeline Logic — Entrance Criteria check khi đổi Stage
- [ ] **CRM-04:** Merge Logic — gom hồ sơ trùng SĐT, cập nhật `customer_id` cho conversations liên quan
- [ ] **CRM-05:** Merge Distributed Lock — Redis Lock namespace `cache` (`lock:merge:phone:${phone}`, TTL 10s)
- [ ] **CRM-06:** ROI Calculator Service — công thức Solar theo vùng miền
- [ ] **CRM-07:** Scoring Engine — eval điểm dựa trên `crm_scoring_rules`
- [ ] **CRM-08:** Activity Observer — Event Subscriber ghi log `crm_activities`
- [ ] **CRM-09:** Migration + Entity `crm_audit_logs`
- [ ] **CRM-10:** TypeORM Audit Subscriber — tự động snapshot INSERT/UPDATE/DELETE
- [ ] **CRM-11:** Audit APIs: `GET /api/v1/crm/audit-logs`, `POST /api/v1/crm/audit-logs/:id/undo`
- [ ] **CRM-12:** `CrmUndoService` — khôi phục từ snapshot trong DB transaction
- [ ] **CRM-13:** Migration + Entity `crm_customer_notes`
- [ ] **CRM-14:** Notes APIs: `GET`/`POST`/`PUT`/`DELETE /api/v1/crm/customers/:id/notes`, `PATCH .../pin`
- [ ] **CRM-15:** Notes Guard — chỉ tác giả hoặc Admin được sửa/xóa
- [ ] **CRM-16:** Audit registration cho `crm_customer_notes` (Subscriber catch INSERT/UPDATE/DELETE)
- [ ] **CRM-24:** `MergeProfileService` — tự động chạy ngầm gộp hồ sơ trùng SĐT, gộp conversations & activities lịch sử, ghi snapshot lỗi xung đột vào note dưới khóa Redis `lock:merge:phone`
- [ ] **CRM-25:** Profile Merge REST API — `POST /api/v1/crm/customers/:id/merge` cho phép gộp thủ công từ UI, bảo vệ bởi `Idempotency-Key`

### Phase 3: Event-Driven Notification Integration

- [ ] **CRM-17:** Event DTOs (có `eventId`): `LeadAssignedEvent`, `LeadScoreHotEvent`, `LeadStatusChangedEvent`, `CustomerNoteMentionedEvent`
- [ ] **CRM-18:** Ghi outbox `lead.assigned` trong `LeadService.assignLead()` transaction [Tham khảo Outbox Spec](system_outbox_pattern.md)
- [ ] **CRM-19:** Ghi outbox `lead.score_hot` trong `ScoringEngineService` khi score ≥ HOT_THRESHOLD [Tham khảo Outbox Spec](system_outbox_pattern.md)
- [ ] **CRM-20:** Ghi outbox `lead.status_changed` trong `PipelineService.moveLeadToStage()` [Tham khảo Outbox Spec](system_outbox_pattern.md)
- [ ] **CRM-21:** Ghi outbox `customer.note_mentioned` — extract `@username` Regex + find userId [Tham khảo Outbox Spec](system_outbox_pattern.md)
- [ ] **CRM-22:** CRM Outbox Sweeper — Cronjob quét `crm_outbox_events` PENDING (dùng `SKIP LOCKED`) và publish vào BullMQ. [Tham khảo Outbox Spec](system_outbox_pattern.md)
- [ ] **CRM-23:** Integration tests: 4 events emit đúng payload qua Outbox [Tham khảo Outbox Spec](system_outbox_pattern.md)

---

## 📥 GIAI ĐOẠN 6: MODULE INBOX

> **Ref:** [specs/inbox/task.md](file:///d:/workspace/project/solavie/specs/inbox/task.md)
>
> ⚠️ **Phụ thuộc: IAM (Phase 1), Gateway (GW-01 → GW-07) hoàn thành.**

### Phase 1: Database & Schema

- [ ] **INB-01:** Migration + Entities: `inbox_quick_replies`, `inbox_internal_comments`
- [ ] **INB-02:** Soft Link config: `chat_conversations` → `inbox_internal_comments`, `iam_users` → `inbox_internal_comments`

### Phase 2: WebSocket Gateway (`InboxGateway`)

- [ ] **INB-03:** WebSocket namespace `inbox` (`@nestjs/websockets` + `socket.io`)
- [ ] **INB-04:** Connection — JWT verify, extract userId, add to Redis Set `online_agents` (cache namespace)
- [ ] **INB-05:** Disconnect — xóa userId khỏi `online_agents`
- [ ] **INB-06:** `client:join_room` → join Socket Room `conversation:<conversationId>`
- [ ] **INB-07:** `client:typing` + `isTyping=true` → set `lock:typing:conversation:<id>` (Redis `cache`, TTL 5s) → broadcast `server:typing_status`
- [ ] **INB-08:** `client:typing` + `isTyping=false` → delete Redis lock → broadcast `server:typing_status`

### Phase 3: REST APIs

- [ ] **INB-09:** `GET /api/v1/inbox/conversations` — phân trang, lọc state/assignee/channel (guard `inbox.conversation.read`)
- [ ] **INB-10:** `GET /api/v1/inbox/conversations/:id/timeline` — merge `chat_messages` + `inbox_internal_comments` sort by time
- [ ] **INB-11:** `POST /api/v1/inbox/conversations/:id/claim` — cập nhật assignee, state=MANUAL, broadcast `server:conversation.assigned`
- [ ] **INB-12:** `POST /api/v1/inbox/conversations/:id/messages` — Sales gửi tin, gọi `GatewayApiService`, update DB, clear typing lock
- [ ] **INB-13:** `POST /api/v1/inbox/conversations/:id/comments` — lưu DB, extract `@username`, `emit('inbox.agent_mentioned', payload)`
- [ ] **INB-14:** `GET /api/v1/inbox/quick-replies` — lấy danh sách mẫu trả lời nhanh
- [ ] **INB-20:** Interaction Window Badge — hiển thị nhãn cảnh báo cửa sổ tương tác 24h (Xanh/Đỏ) trên khung chat livechat
- [ ] **INB-21:** Outside Window Composer Policy — tự động lock composer khi ngoài 24h (FB/Zalo), chỉ cho phép Sales chọn mẫu tin nhắn mẫu (ZNS/Message Tag) có sẵn để gửi đi

### Phase 4: Round-Robin Auto-Routing

- [ ] **INB-15:** `AutoAssignmentService.assignConversationRoundRobin(conversationId)`
- [ ] **INB-16:** Round-Robin logic — `online_agents` Redis Set, pointer Redis `cache`, `%` vòng tròn, update DB + broadcast

### Phase 5: Automated Testing

- [ ] **INB-17:** Unit tests `AutoAssignmentService` — không có online agent, xoay vòng nhiều sales
- [ ] **INB-18:** Integration tests `InboxGateway` — typing lock TTL, sync event
- [ ] **INB-19:** Unit tests @mention extraction regex + `inbox.agent_mentioned` payload

---

## 📅 GIAI ĐOẠN 7: MODULE BOOKING

> **Ref:** [specs/booking/task.md](file:///d:/workspace/project/solavie/specs/booking/task.md)
>
> ⚠️ **Phụ thuộc: IAM (Phase 1), CRM (Phase 1-2) hoàn thành.**

### Phase 1: Database & Schema

- [ ] **BK-01:** Migration + Entities: `booking_event_types`, `booking_availabilities`, `booking_appointments`
- [ ] **BK-02:** Soft Links config sang `crm_customers` và `iam_users` tại service layer

### Phase 2: Core Scheduling APIs

- [ ] **BK-03:** Event Types CRUD — `GET`/`POST`/`PUT /api/v1/booking/event-types` (Admin)
- [ ] **BK-04:** Sales Availability CRUD — `GET`/`POST /api/v1/booking/availabilities`
- [ ] **BK-05:** `AvailableSlotsService` — thuật toán sinh giờ trống (lọc DB + Google Calendar + Buffer 15p + Min Notice 2h)
- [ ] **BK-06:** `GET /api/v1/booking/slots` (public) — trả về danh sách slot trống

### Phase 3: Booking & CRM Sync

- [ ] **BK-07:** `POST /api/v1/booking/appointments` — đặt lịch hẹn, chuẩn hóa và validate số điện thoại di động Việt Nam (ném lỗi `INVALID_PHONE_NUMBER` nếu sai)
- [ ] **BK-08:** Round-Robin Host Allocation — Redis pointer nếu không chỉ định Sales
- [ ] **BK-09:** CRM Customer Sync — tìm hoặc tạo `crm_customers`, gán `assignee_id`
- [ ] **BK-10:** CRM Activity Log — ghi `APPOINTMENT_SCHEDULED` vào `crm_activities`
- [ ] **BK-11:** Cancel & Reschedule APIs — update status `CANCELLED`/`RESCHEDULED`

### Phase 4: Event-Driven Notification Integration

- [ ] **BK-12:** Event classes `AppointmentConfirmedEvent`, `AppointmentCancelledEvent` (chứa `eventId`)
- [ ] **BK-13:** Ghi outbox `appointment.confirmed` sau `commitTransaction()` thành công [Tham khảo Outbox Spec](system_outbox_pattern.md)
- [ ] **BK-14:** Ghi outbox `appointment.cancelled` khi hủy/dời lịch [Tham khảo Outbox Spec](system_outbox_pattern.md)
- [ ] **BK-15:** Booking Outbox Sweeper — Cronjob quét `booking_outbox_events` PENDING (dùng `SKIP LOCKED`) và publish vào BullMQ. [Tham khảo Outbox Spec](system_outbox_pattern.md)
- [ ] **BK-16:** Xóa `ReminderScheduler` cũ (nếu có), remove BullMQ dependency khỏi `BookingModule`

### Phase 5: AI Chatbot Integration

- [ ] **BK-17:** Tool `get_booking_slots` cho ReAct Agent (truy vấn public slots API)
- [ ] **BK-18:** Tool `create_appointment` cho ReAct Agent (xử lý exception `INVALID_PHONE_NUMBER` để chatbot phản hồi)

### Phase 6: Automated Testing

- [ ] **BK-19:** Unit tests slot calculation — trùng lịch, Buffer Time, Min Notice
- [ ] **BK-20:** Unit tests Phone Validation — validate các trường hợp số điện thoại
- [ ] **BK-21:** Unit tests Round-Robin — nhiều khách book đồng thời
- [ ] **BK-22:** Integration tests event emission — `appointment.confirmed` + `appointment.cancelled`

---

## 🔔 GIAI ĐOẠN 8: MODULE NOTIFICATION

> **Ref:** [specs/notification/task.md](file:///d:/workspace/project/solavie/specs/notification/task.md)
>
> ⚠️ **Phụ thuộc: IAM (Phase 1), DevOps (Phase 4 — env vars), Socket.io setup.**
> ⚠️ **Module này phụ thuộc ngược: tất cả module emit events phải hoàn thành trước Phase D.**

### Phase A: Tài Liệu ✅

- [x] **NOT-A1:** `specs/notification/requirement.md`
- [x] **NOT-A2:** `specs/notification/design.md`
- [x] **NOT-A3:** `specs/notification/business_logic.md`
- [x] **NOT-A4:** `specs/notification/logging.md`
- [x] **NOT-A5:** `specs/notification/task.md`
- [ ] **NOT-A6:** Cập nhật `docs/architecture_design.md` — thêm Notification vào diagram
- [ ] **NOT-A7:** Verify `docs/database_schema.md` đã có 3 bảng notification

### Phase B: Cập Nhật Specs Module Liên Quan

- [ ] **NOT-B1:** `specs/booking/requirement.md §2.5` — Refactor: Booking emit event thay vì tự gửi
- [ ] **NOT-B2:** `specs/chatbot/requirement.md §2.5` — emit event `chat.handover_requested`
- [ ] **NOT-B3:** `specs/inbox/requirement.md §2.4` — emit event `inbox.agent_mentioned`
- [ ] **NOT-B4:** `specs/crm/requirement.md` — thêm §2.9 về emit events CRM
- [ ] **NOT-B5:** `specs/iam/requirement.md` — thêm §2.5 về emit events IAM

### Phase C: Triển Khai Mã Nguồn

**C.1 — Module Setup & Database:**
- [ ] **NOT-C1:** `src/notification/notification.module.ts`
- [ ] **NOT-C2:** Migration: `notification_preferences`, `notification_templates`, `notification_logs`
- [ ] **NOT-C3:** TypeORM Entities: `NotificationPreferenceEntity`, `NotificationTemplateEntity`, `NotificationLogEntity`
- [ ] **NOT-C4:** Repositories tương ứng

**C.2 — Core Services:**
- [ ] **NOT-C5:** `IdempotencyService` — SHA256 key generation + DB check (chống gửi trùng) [Tham khảo Inbox Pattern Spec](system_inbox_pattern.md)
- [ ] **NOT-C6:** `PreferenceService` — lookup preference + quiet hours + event override check
- [ ] **NOT-C7:** `TemplateEngineService` — Handlebars renderer + template lookup (event_type, channel, language)
- [ ] **NOT-C8:** `NotificationRouter` — fan-out logic, channel decision matrix
- [ ] **NOT-C9:** `NotificationService` — main orchestrator + `@OnEvent` handlers (13 event types)

**C.3 — Provider Pattern:**
- [ ] **NOT-C10:** `INotificationProvider` interface
- [ ] **NOT-C11:** `InAppProvider` — Socket.io direct emit (Tier 1 Critical, < 500ms)
- [ ] **NOT-C12:** `EmailProvider` — Nodemailer + AWS SES transport
- [ ] **NOT-C13:** `ZaloProvider` — Zalo ZNS API client + chuẩn hóa số điện thoại 84xxxxxxxxx
- [ ] **NOT-C14:** `ProviderRegistry` — factory inject đúng provider theo channel

**C.4 — BullMQ Queues & Workers:**
- [ ] **NOT-C15:** Define 3 queues: `email-notification-queue`, `zalo-notification-queue`, `scheduled-notification-queue`
- [ ] **NOT-C16:** `EmailWorker` — BullMQ Processor + error handling + log update
- [ ] **NOT-C17:** `ZaloWorker` — BullMQ Processor + ZNS API + tự động fallback gửi Email qua AWS SES khi ZNS gặp lỗi
- [ ] **NOT-C18:** `ScheduledWorker` — delayed job processor (reminder 24h + 1h)
- [ ] **NOT-C19:** DLQ handling sau `maxAttempts` exceeded

**C.5 — Integration (Event Emitter Wiring):**
- [ ] **NOT-C20:** `emit('chat.handover_requested')` → Chatbot Module handover flow (xem CB-31)
- [ ] **NOT-C21:** `emit('inbox.agent_mentioned')` → Inbox @mention handler (xem INB-13)
- [ ] **NOT-C22:** `emit('lead.assigned')` → CRM (xem CRM-18)
- [ ] **NOT-C23:** `emit('lead.score_hot')` → CRM (xem CRM-19)
- [ ] **NOT-C24:** `emit('appointment.confirmed')` → Booking (xem BK-13)
- [ ] **NOT-C25:** `emit('appointment.cancelled')` → Booking (xem BK-14)
- [ ] **NOT-C26:** `emit('auth.login_new_device')` → IAM (xem IAM-13)
- [ ] **NOT-C27:** `emit('permission.changed')` → IAM (xem IAM-14)
- [ ] **NOT-C28:** `emit('auth.user_created')` → IAM (xem IAM-22)
- [ ] **NOT-C29:** `emit('auth.password_changed')` → IAM (xem IAM-18)

**C.6 — DevOps Config:**
- [ ] **NOT-C30:** Env vars vào `docker-compose.yml` (xem DEV-13/14)

### Phase D: Kiểm Thử & Nghiệm Thu

- [ ] **NOT-D1:** Unit test `IdempotencyService` — duplicate detection [Tham khảo Inbox Pattern Spec](system_inbox_pattern.md)
- [ ] **NOT-D2:** Unit test `PreferenceService` — quiet hours, opt-out, event override
- [ ] **NOT-D3:** Unit test `TemplateEngineService` — Handlebars variables
- [ ] **NOT-D4:** Unit test `NotificationRouter` — fan-out logic từng event type
- [ ] **NOT-D5:** Integration test: `appointment.confirmed` → 2 Email + 1 Zalo + 2 Scheduled jobs
- [ ] **NOT-D6:** Integration test: `appointment.cancelled` → hủy scheduled jobs + gửi thông báo hủy
- [ ] **NOT-D7:** Integration test: `chat.handover_requested` → In-App WebSocket < 500ms
- [ ] **NOT-D8:** Idempotency test: cùng event gửi 2 lần → chỉ 1 notification delivered [Tham khảo Inbox Pattern Spec](system_inbox_pattern.md)
- [ ] **NOT-D9:** DLQ test: EmailProvider fail 3 lần → job vào DLQ + log FAILED
- [ ] **NOT-D10:** Zalo Fallback test: ZNS thất bại do SĐT không đăng ký Zalo hoặc lỗi API ZNS → tự động gửi Email fallback qua AWS SES thành công
- [ ] **NOT-D11:** Quiet Hours test: Email blocked → In-App vẫn gửi

---

## 💾 GIAI ĐOẠN 9: MODULE STORAGE

> **Ref:** [specs/storage/task.md](file:///d:/workspace/project/solavie/specs/storage/task.md)

- [x] **STG-01:** MinIO Docker container (→ DevOps task DEV-07)
- [ ] **STG-02:** `StorageService` — cài `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, S3 API wrapper
- [ ] **STG-03:** Bucket Provisioning Script — tự động tạo 4 buckets khi bootstrap
- [ ] **STG-04:** API Presigned POST (`POST /api/v1/storage/upload/presigned-url`) có validation dung lượng, type
- [ ] **STG-05:** API Confirm Upload (`POST /api/v1/storage/upload/confirm`) — chuyển file từ tmp/ sang public/, đổi `is_confirmed = true`
- [ ] **STG-06:** API Presigned GET (`GET /api/v1/storage/download/:fileId`) — cho các bucket private
- [ ] **STG-07:** BullMQ Worker (Image Optimization) — tự động nén, resize ảnh sang WebP (sharp) và emit `storage.image_processed`
- [ ] **STG-08:** Garbage Collector Cron Job — `@Cron` xóa file `is_confirmed=false` quá 24h (MinIO OLM)

---

## 🧪 GIAI ĐOẠN 10: END-TO-END INTEGRATION TESTS

> *Thực hiện sau khi toàn bộ module hoàn thành.*

- [ ] **E2E-01:** Full Activation Flow — Admin tạo user → Email link → exchange token → SetupJWT → activate → login thành công
- [ ] **E2E-02:** Full Chat Flow FB — Webhook nhận → Queue → Chatbot AI → RAG → Reply → ghi DB
- [ ] **E2E-03:** Full Chat Flow Zalo — tương tự trên kênh Zalo
- [ ] **E2E-04:** Lead Extraction → CRM tạo hồ sơ → Score → HOT alert → Notification In-App Sales
- [ ] **E2E-05:** AI Booking Flow — AI detect nhu cầu → gọi tool slots → tạo appointment → emit event → Email + Zalo ZNS
- [ ] **E2E-06:** Handover Flow — AI OOD x2 → emit handover → Sales nhận In-App → claim → gửi tin → handback
- [ ] **E2E-07:** Permission Change → Admin thay đổi Role → Cache bị xóa → User nhận In-App + Email → API từ chối với quyền cũ
- [ ] **E2E-08:** Password Change → Tất cả sessions bị revoke → Login lại cần credentials mới

---

## 📈 DEPENDENCY MAP (Thứ Tự Triển Khai Bắt Buộc)

```
GIAI ĐOẠN 0: System Specs ──────────────────────────────────────────┐
                                                                      ↓
GIAI ĐOẠN 1: DevOps (Docker, Redis, DB, MinIO, LiteLLM) ──────────→ ↓
                                                                      ↓
GIAI ĐOẠN 2: IAM (Auth, Guard, JWT) ──────────────────────────────→ ↓
         ↓                                                            |
         ↓ (IAM Phase 1 done)                                        |
GIAI ĐOẠN 3: Gateway ─────────────────────────────────────────────→ ↓
         ↓                                                            |
         ↓ (Gateway GW-01..13 done)                                  |
GIAI ĐOẠN 4: Chatbot ─────── Phase 1-3 phụ thuộc Gateway           |
GIAI ĐOẠN 5: CRM ──────────────────────────── ↓                    |
         ↓ (CRM Phase 1-2 done)               ↓                    |
GIAI ĐOẠN 6: Inbox ─────────────── (cần IAM + Gateway)             |
GIAI ĐOẠN 7: Booking ──────────── (cần IAM + CRM)                  |
         ↓                         ↓                                |
         └──────── emit events ──────┘                              |
                       ↓                                            |
GIAI ĐOẠN 8: Notification ─── consumer tất cả events ──────────────┘
GIAI ĐOẠN 9: Storage ──────────────────────── (độc lập, bất kỳ lúc nào)
GIAI ĐOẠN 10: E2E Tests ─────── (toàn bộ modules hoàn thành)
```

---

## 📌 GHI CHÚ QUẢN LÝ

### Quy Tắc Cập Nhật Task:
1. Khi bắt đầu task: `[ ]` → `[/]` tại cả 2 file (master + module task file)
2. Khi hoàn thành: `[/]` → `[x]` tại cả 2 file
3. Cập nhật bảng **TỔNG QUAN TIẾN ĐỘ** ở đầu file theo tuần

### Definition of Done (DoD) cho mỗi task:
- ✅ Code viết xong, theo đúng spec đặc tả
- ✅ Unit test viết xong + pass
- ✅ Logging JSON đầy đủ theo `specs/iam/logging.md` (hoặc logging module tương ứng)
- ✅ Không có raw secret, password, token trong log
- ✅ `traceId` được truyền xuyên suốt

### Các Module Spec Cần Bổ Sung (TODO Docs):
- [x] `specs/inbox/` — Đã hoàn thiện `business_logic.md` chi tiết ABAC cho Inbox
- [x] `specs/booking/` — Đã thêm Google Calendar integration spec chi tiết (Two-way sync, Webhook, OAuth2)
- [x] `specs/storage/` — Đã hoàn thiện `business_logic.md` và `logging.md`
- [x] `specs/devops/` — Đã thêm `logging.md` (Promtail + Loki config chuẩn hóa)
