# Task Lập Trình Module Agent Inbox (Sales Chat Portal)

Kế hoạch lập trình và triển khai module Agent Inbox được phân chia thành các task cụ thể theo đúng đặc tả và thiết kế kỹ thuật đã được phê duyệt:

## Phase 1: Database & Schema Integration
- [ ] **Migration & Entities Creation:** Tạo file migration và định nghĩa Entities trong NestJS cho ba bảng mới:
  - `inbox_quick_replies` (id, shortcut, content, created_at).
  - `inbox_internal_comments` (id, conversation_id, sender_id, content, created_at).
  - `inbox_outbox_events` (id, event_type, payload, status).
- [ ] **Database Relations Configuration:** Cấu hình mối quan hệ thực thể (Soft links):
  - `chat_conversations` có nhiều `inbox_internal_comments`.
  - `iam_users` viết nhiều `inbox_internal_comments`.

## Phase 2: WebSockets Gateway (`InboxGateway`)
- [ ] **Setup WebSocket Namespace:** Khai báo và cấu hình `InboxGateway` trong namespace `inbox` sử dụng `@nestjs/websockets` và `@nestjs/platform-socket.io`.
- [ ] **Connection & Online Status Management:**
  - Lắng nghe event `connection`: Xác thực người dùng (Sales), trích xuất `userId` từ JWT token, và thêm `userId` vào Redis Set `online_agents` (sử dụng Redis client namespace `cache`).
  - Lắng nghe event `disconnect`: Xóa `userId` khỏi Redis Set `online_agents` (sử dụng Redis client namespace `cache`).
- [ ] **Conversation Room Handling:** Lắng nghe event `client:join_room` để đưa socket của Sales vào Room Socket `conversation:<conversationId>`.
- [ ] **Collision Detection (Typing Lock):**
  - Lắng nghe event `client:typing` với payload `{ conversationId, isTyping }`.
  - Nếu `isTyping = true`: Lưu trữ thông tin Agent đang gõ vào Redis key `lock:typing:conversation:<conversationId>` với TTL = 5 giây (sử dụng Redis client namespace `cache`). Phát event `server:typing_status` tới tất cả Sales khác trong room kèm theo `expiresAt` (Unix timestamp ms).
  - Nếu `isTyping = false`: Xóa key trong Redis `cache` (nếu đúng Agent đang giữ lock) và phát event `server:typing_status` với `isTyping = false`.

## Phase 3: REST APIs Implementation
- [ ] **Define Permission Constants:** Tạo file `inbox.permissions.ts` định nghĩa các hằng số quyền như `inbox.conversation.read`, `inbox.conversation.write` và đăng ký tự động vào global registry lúc khởi chạy.
- [ ] **Implement ConversationHydrator:** Xây dựng `ConversationHydrator` triển khai interface `ResourceHydrator` từ Core Database, chỉ select các trường tối thiểu (`id`, `state`, `assignee_id`, `channel`) và đăng ký với `ResourceHydratorRegistry` dưới tiền tố `inbox.conversation`.
- [ ] **Inbox Feed API with QueryHelper:** Triển khai endpoint `GET /api/v1/inbox/conversations` kèm `JwtAuthGuard` và `PermissionsGuard`. Tích hợp `TypeOrmQueryHelper` để xử lý phân trang, lọc (`state`, `assignee_id`, `channel`), sắp xếp (`last_message_at`, `created_at`), và tìm kiếm (`customer_name`, `last_message_content`).
- [ ] **Timeline Sync API:** Triển khai endpoint `GET /api/v1/inbox/conversations/:id/timeline` thu thập cả tin nhắn hội thoại (`chat_messages`) và bình luận nội bộ (`inbox_internal_comments`), gộp và sắp xếp theo thời gian để hiển thị trên dòng thời gian Portal.
- [ ] **Claim Conversation API with ABAC:** Triển khai endpoint `POST /api/v1/inbox/conversations/:id/claim` kèm check ABAC (chỉ cho phép nếu cuộc hội thoại có trạng thái `MANUAL` và `assignee_id` rỗng). Cập nhật `assignee_id = agentId`, chuyển `state = 'MANUAL'`, và broadcast event `server:conversation.assigned`.
- [ ] **Sales Send Message API with ABAC:**
  - Triển khai endpoint `POST /api/v1/inbox/conversations/:id/messages` kèm check ABAC (chỉ cho phép nếu trạng thái là `MANUAL` và `assignee_id` là user hiện tại hoặc là Admin/Manager).
  - Lưu tin nhắn vào DB dưới dạng `HUMAN_AGENT`.
  - Gọi HTTP Client `GatewayApiService` để đẩy tin sang Facebook/Zalo API thực tế.
  - Xóa Typing Lock trên Redis và broadcast sự kiện tắt trạng thái gõ phím.
- [ ] **Internal Comments API with ABAC:**
  - Triển khai endpoint `POST /api/v1/inbox/conversations/:id/comments` kèm check ABAC (chỉ cho phép nếu trạng thái `MANUAL` và `assignee_id` là user hiện tại hoặc Admin/Manager).
  - Lưu ghi chú vào bảng `inbox_internal_comments`.
  - Trích xuất tags `@username` từ nội dung comment bằng Regex. Tìm `userId` tương ứng và ghi bản ghi `inbox.agent_mentioned` vào bảng `inbox_outbox_events` trong cùng DB Transaction.
- [ ] **Inbox Outbox Processor & Sweeper:** Triển khai BullMQ Processor và Cronjob Sweeper (dùng `SKIP LOCKED`) quét định kỳ bảng `inbox_outbox_events` và publish ra Event Bus. [Tham khảo Outbox Spec](../system_outbox_pattern.md)
- [ ] **Quick Replies API with QueryHelper:** Triển khai endpoint `GET /api/v1/inbox/quick-replies` sử dụng `TypeOrmQueryHelper` hỗ trợ lọc, tìm kiếm và phân trang cho các mẫu câu trả lời nhanh.

## Phase 4: Round-Robin Auto-Routing Implementation
- [ ] **Auto-Assignment Service:** Triển khai `AutoAssignmentService` và phương thức `assignConversationRoundRobin(conversationId)`.
- [ ] **Round-Robin Assignment Logic:**
  - Lấy danh sách active agents từ Redis Set `online_agents` (sử dụng Redis client namespace `cache`), sắp xếp theo thứ tự bảng chữ cái.
  - Đọc con trỏ từ Redis key `pointer:round_robin_sales` trong Redis `cache` (mặc định = 0).
  - Chọn agent tại vị trí `pointer % online_agents.length`, cập nhật `assignee_id = assignedSalesId` và `state = 'MANUAL'` trong DB.
  - Broadcast sự kiện `server:conversation.assigned`.
  - Tăng con trỏ và lưu lại Redis `cache`.
- [ ] **Integration Trigger:** Tích hợp trigger gọi dịch vụ này khi Chatbot AI phát lệnh handover, hoặc khi có tin nhắn mới từ khách hàng mà cuộc trò chuyện đang ở trạng thái `MANUAL` nhưng chưa được gán cho bất kỳ Agent nào.

## Phase 5: Automated Testing & Verification
- [ ] **Unit Tests for Assignment:** Viết test suite cho `AutoAssignmentService` giả lập các kịch bản không có sales online, xoay vòng tuần tự khi có nhiều sales online.
- [ ] **WebSocket Gateway Tests:** Viết integration tests cho `InboxGateway` để kiểm tra cơ chế ghi nhớ lock gõ phím trên Redis, tự động hết hạn lock sau 5 giây và đồng bộ sự kiện typing.
- [ ] **Internal Comment Tagging Tests:** Viết unit tests kiểm chứng khả năng trích xuất tên chính xác bằng Regex từ ghi chú nội bộ và kiểm tra sự kiện `inbox.agent_mentioned` được ghi đúng vào Outbox. [Tham khảo Outbox Spec](../system_outbox_pattern.md)
- [ ] **Handover Event Tests:** Viết unit test kiểm tra khi Auto-Routing gán Sales, event `inbox.new_message` được emit cho đúng `assigneeId`.

## Phase 6: Omnichannel 24h Window & Composer Lock
- [ ] **24-Hour Timer Utility on Frontend:** Xây dựng hook đếm ngược thời gian từ `last_customer_message_at` để hiển thị nhãn cảnh báo thời gian thực (Xanh/Đỏ) trên UI.
- [ ] **Composer Lock Logic on Frontend:** Lắng nghe giá trị đếm ngược; vô hiệu hóa trường soạn thảo tự do (input text area) và nút gửi khi ngoài 24 giờ.
- [ ] **Tag Selection Dropdown UI:** Khi composer bị khóa, hiển thị dropdown danh sách các mẫu tin nhắn được duyệt trước cùng các tag phù hợp (`CONFIRMED_EVENT_UPDATE` hoặc `HUMAN_AGENT`).
- [ ] **Backend 24-Hour Policy Validation:** Trong API `POST /api/v1/inbox/conversations/:id/messages`, bổ sung logic ném exception `OUTSIDE_24H_WINDOW` nếu gửi tin nhắn thường ngoài 24h, và chỉ cho phép nếu tin nhắn có kèm tag hợp lệ (đối với Facebook) hoặc ném lỗi cấm hoàn toàn tin nhắn tự do (đối với Zalo).
- [ ] **Integration Testing for 24h Policy:** Viết unit test giả lập tình huống `last_customer_message_at` cách đây 25h, gửi tin nhắn text thường và kiểm tra xem có ném đúng lỗi `OUTSIDE_24H_WINDOW` hay không.
