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
- [ ] **Inbox Feed API & ABAC:** Triển khai endpoint `GET /api/v1/inbox/conversations` kèm JWT Guard. Tích hợp ABAC Filtering qua QueryBuilder (Sales chỉ xem hội thoại của mình hoặc MANUAL vô chủ). Hỗ trợ phân trang, trạng thái, assignee và channel.
- [ ] **Timeline Sync API:** Triển khai endpoint `GET /api/v1/inbox/conversations/:id/timeline` thu thập cả tin nhắn hội thoại (`chat_messages`) và bình luận nội bộ (`inbox_internal_comments`), gộp và sắp xếp theo thời gian để hiển thị trên dòng thời gian Portal.
- [ ] **Claim Conversation API:** Triển khai endpoint `POST /api/v1/inbox/conversations/:id/claim` cho phép Sales chủ động tiếp quản chat. Cập nhật `assignee_id = agentId`, chuyển `state = 'MANUAL'`, và broadcast event `server:conversation.assigned` tới toàn hệ thống.
- [ ] **Sales Send Message API:**
  - Triển khai endpoint `POST /api/v1/inbox/conversations/:id/messages`.
  - Nếu cuộc chat đang ở trạng thái `AUTOMATIC`, chuyển sang `MANUAL` và gán cho Agent hiện tại, broadcast event gán vai mới.
  - Lưu tin nhắn vào DB dưới dạng `HUMAN_AGENT`.
  - Gọi HTTP Client `GatewayApiService` để đẩy tin sang Facebook/Zalo API thực tế.
  - Xóa Typing Lock trên Redis và broadcast sự kiện tắt trạng thái gõ phím.
- [ ] **Internal Comments API:**
  - Triển khai endpoint `POST /api/v1/inbox/conversations/:id/comments`.
  - Lưu ghi chú vào bảng `inbox_internal_comments`.
  - Trích xuất tags `@username` từ nội dung comment bằng Regex. Tìm `userId` tương ứng và ghi bản ghi `inbox.agent_mentioned` vào bảng `inbox_outbox_events` (có `eventId`) trong cùng DB Transaction. Không bắn WebSocket event trực tiếp từ Inbox Module.
- [ ] **Inbox Outbox Processor & Sweeper:** Triển khai BullMQ Processor và Cronjob Sweeper (dùng `SKIP LOCKED`) quét định kỳ bảng `inbox_outbox_events` và publish ra Event Bus. [Tham khảo Outbox Spec](../system_outbox_pattern.md)
- [ ] **Quick Replies API:** Triển khai endpoint `GET /api/v1/inbox/quick-replies` để lấy các mẫu câu trả lời nhanh đã cấu hình sẵn.

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
