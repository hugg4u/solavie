# Task Lập Trình Module CRM (Developer Tasks)

- `[ ]` **Setup Entity & Migration:** Khởi tạo các TypeORM Entities cho `crm_customers`, `crm_stages`, `crm_field_definitions`, `crm_scoring_rules`, `crm_activities`.
- `[ ]` **CRM Permissions & Sync Config:**
  - Tạo tệp `crm.permissions.ts` chứa các hằng số quyền của CRM.
  - Đăng ký hằng số này vào `permission-registry.ts` ở Core để kích hoạt Auto-Sync khi chạy hệ thống.
  - Cấu hình mapping quyền mặc định cho các vai trò trong `IamSeedService` (ví dụ: `ADMIN` full crm.*, `SALES` chỉ crm.customer.read/write, crm.note.*).
- `[ ]` **CRUD Configuration:** Viết các APIs cho Admin cấu hình Fields, Stages, Rules.
- `[ ]` **Dynamic Pipeline Logic:** Implement Service Layer kiểm tra Entrance Criteria khi đổi Stage.
- `[ ]` **Merge Logic:** Triển khai `MergeProfileService` thực hiện tự động gộp hồ sơ trùng số điện thoại, hợp nhất thông tin cá nhân, custom fields, timeline conversations/activities, và soft-delete profile phụ. Lưu vết dữ liệu bị ghi đè vào một ghi chú viết tay.
- `[ ]` **Manual Merge API Endpoint:** Triển khai route `POST /api/v1/crm/customers/merge` kèm theo validation DTO `MergeCustomersRequestDto`, phân quyền `crm.customer.write` và áp dụng ABAC check quyền sở hữu qua `CustomerHydrator`.
- `[ ]` **Merge Lead Distributed Lock:** Tích hợp khóa phân tán Redis Lock `lock:merge:phone:${phone}` (TTL 10s) sử dụng Redis client vào luồng gộp hồ sơ để bảo vệ toàn vẹn dữ liệu.
- `[ ]` **ROI Calculator Service:** Cài đặt công thức tính toán Solar dựa trên cấu hình Vùng miền.
- `[ ]` **Scoring Engine:** Viết logic eval (đánh giá) điểm dựa trên `crm_scoring_rules`.
- `[ ]` **Activity Observer:** Viết Subscribers lắng nghe Event để tự động ghi log vào `crm_activities`.
- `[ ]` **Audit Database Setup:** Tạo migration và TypeORM Entity cho bảng `crm_audit_logs` để lưu trữ snapshot thay đổi dạng JSONB.
- `[ ]` **TypeORM Audit Subscriber:** Viết `CrmAuditSubscriber` để tự động bắt các sự kiện ghi dữ liệu của các bảng được cấu hình và lưu snapshot.
- `[ ]` **CRM Audit & Undo API:** Xây dựng các API `GET /api/v1/crm/audit-logs` (áp dụng `TypeOrmQueryHelper`) và `POST /api/v1/crm/audit-logs/:id/undo` kèm phân quyền check quyền `crm.audit.undo`.
- `[ ]` **Undo Transaction Service:** Viết `CrmUndoService` xử lý khôi phục dữ liệu an toàn dựa trên snapshot, đảm bảo chạy trong database transaction và bắt lỗi ràng buộc cơ sở dữ liệu.
- `[ ]` **Take-Note Entity & Migration:** Tạo TypeORM Entity và file migration cho bảng `crm_customer_notes` (thiết lập soft link tới khách hàng và nhân viên).
- `[ ]` **Customer Notes APIs:** Xây dựng các REST APIs `GET /api/v1/crm/customers/:id/notes` (áp dụng `TypeOrmQueryHelper`), `POST`, `PUT`, `DELETE` và `PATCH /notes/:noteId/pin` kèm theo các validation DTOs.
- `[ ]` **CRM Resource Hydrators implementation:**
  - Triển khai `CustomerHydrator` và `NoteHydrator` kế thừa `ResourceHydrator`.
  - Đăng ký các Hydrator này vào `ResourceHydratorRegistry` ở pha `onModuleInit` để tích hợp động với `PermissionsGuard`.
- `[ ]` **Customer List API Refactoring:** Tái cấu trúc API `GET /api/v1/crm/customers` kế thừa `PaginationQueryDto` và sử dụng `TypeOrmQueryHelper.apply()` để hỗ trợ phân trang, tìm kiếm, lọc và sắp xếp.
- `[ ]` **Take-Note Audit Registration:** Cấu hình để `CrmAuditSubscriber` tự động lưu vết audit log khi có thao tác INSERT, UPDATE, DELETE trên bảng `crm_customer_notes`.
- `[ ]` **Take-Note Audit Registration:** Cấu hình để `CrmAuditSubscriber` tự động lưu vết audit log khi có thao tác INSERT, UPDATE, DELETE trên bảng `crm_customer_notes`.

## Phase 3: Event-Driven Notification Integration
- `[ ]` **CrmEventPayload DTOs:** Tạo các class Payload cho từng loại sự kiện CRM (`LeadAssignedEvent`, `LeadScoreHotEvent`, `LeadStatusChangedEvent`, `CustomerNoteMentionedEvent`) trong `crm/events/`, yêu cầu bắt buộc có thuộc tính `eventId: string`.
- `[ ]` **Ghi outbox lead.assigned:** Trong `LeadService.assignLead()`, cùng một DB transaction, ghi vào bảng `crm_outbox_events` loại sự kiện `lead.assigned` bao gồm `eventId`, `leadId`, `leadName`, `leadPhone`, `assigneeId`, `assigneeEmail`. [Tham khảo Outbox Spec](../system_outbox_pattern.md)
- `[ ]` **Ghi outbox lead.score_hot:** Trong `ScoringEngineService`, khi tính toán xét Lead đạt ngưỡng `score >= HOT_THRESHOLD`, ghi sự kiện `lead.score_hot` vào `crm_outbox_events`. [Tham khảo Outbox Spec](../system_outbox_pattern.md)
- `[ ]` **Ghi outbox lead.status_changed:** Trong `PipelineService.moveLeadToStage()`, ghi sự kiện `lead.status_changed` vào `crm_outbox_events`. [Tham khảo Outbox Spec](../system_outbox_pattern.md)
- `[ ]` **Ghi outbox customer.note_mentioned:** Trong `CustomerNoteService.createNote()`, trích xuất `@username` bằng Regex, tìm `userId` và ghi vào `crm_outbox_events` loại `customer.note_mentioned`. [Tham khảo Outbox Spec](../system_outbox_pattern.md)
- `[ ]` **CRM Outbox Sweeper:** Dựng Cronjob hoặc BullMQ Sweeper quét định kỳ (dùng SKIP LOCKED) bảng `crm_outbox_events` (trạng thái PENDING) để publish vào Event Bus. [Tham khảo Outbox Spec](../system_outbox_pattern.md)
- `[ ]` **Integration Tests:** Viết test kiểm tra tất cả 4 events được ghi đúng vào Outbox thay vì phát thẳng ra ngoài khi business logic tương ứng được gọi. [Tham khảo Outbox Spec](../system_outbox_pattern.md)
