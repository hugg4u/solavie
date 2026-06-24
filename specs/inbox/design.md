# Thiết Kế Kiến Trúc Module Agent Inbox (Design)

## 1. Lựa Chọn Công Nghệ (Tech Stack)
- **Framework:** NestJS.
- **Real-time Communication:** WebSockets sử dụng `@nestjs/websockets` và `@nestjs/platform-socket.io` (Socket.io).
- **Caching & Locks:** Redis Cache (`REDIS_CACHE_URL`) lưu trạng thái gõ phím tạm thời để tối ưu hóa Collision Detection.

---

## 2. Thiết Kế Database (Lược đồ bổ sung)

### 2.1. Bảng `inbox_quick_replies` (Mẫu trả lời nhanh)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY, Default gen_random_uuid() | Định danh |
| `shortcut` | VARCHAR(50) | UNIQUE, NOT NULL | Phím tắt (Ví dụ: `baogia`, `inverter`) |
| `content` | TEXT | NOT NULL | Nội dung mẫu tin nhắn trả lời |
| `created_at` | TIMESTAMP | Default NOW() | Thời gian tạo |

### 2.2. Bảng `inbox_internal_comments` (Thảo luận nội bộ)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY, Default gen_random_uuid() | Định danh |
| `conversation_id`| UUID | NOT NULL (Soft link `chat_conversations.id`) | Thuộc cuộc trò chuyện nào |
| `sender_id` | UUID | NOT NULL (Soft link `iam_users.id`) | Người viết ghi chú |
| `content` | TEXT | NOT NULL | Nội dung ghi chú (Hỗ trợ tag `@tên`) |
| `created_at` | TIMESTAMP | Default NOW() | Thời gian tạo |

---

## 3. Thiết Kế REST API (REST Contracts)

### 3.1. API Lấy danh sách cuộc hội thoại cho Feed
*   **Method & Route:** `GET /api/v1/inbox/conversations`
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('inbox.conversation.read')`
*   **Request Query Param (`GetConversationsQueryDto`):**
    ```typescript
    export class GetConversationsQueryDto {
      @IsOptional()
      @IsEnum(['AUTOMATIC', 'MANUAL'])
      state?: string;

      @IsOptional()
      @IsUUID()
      assignee_id?: string;

      @IsOptional()
      @IsString()
      channel?: string; // FACEBOOK, ZALO

      @IsOptional()
      @IsInt()
      page?: number = 1;

      @IsOptional()
      @IsInt()
      limit?: number = 20;
    }
    ```
*   **Response DTO (`ConversationFeedDto`):**
    ```typescript
    export class ConversationFeedDto {
      id: string;
      channel: string;
      sender_id: string;
      state: string;
      assignee_id: string | null;
      assignee_name: string | null;
      customer_name: string | null;
      last_message_content: string | null;
      last_message_at: Date;
    }
    ```

### 3.2. API Lấy lịch sử tin nhắn & ghi chú nội bộ (Timeline)
*   **Method & Route:** `GET /api/v1/inbox/conversations/:id/timeline`
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('inbox.conversation.read')`
*   **Response DTO (`TimelineItemDto`):**
    Trả về danh sách gộp cả tin nhắn chat và ghi chú nội bộ, sắp xếp theo `created_at` tăng dần.
    ```typescript
    export class TimelineItemDto {
      id: string;
      type: 'MESSAGE' | 'INTERNAL_COMMENT';
      sender_type: 'CUSTOMER' | 'AI' | 'HUMAN_AGENT' | 'SYSTEM';
      sender_name: string | null;
      content: string;
      created_at: Date;
    }
    ```

### 3.3. API Sales gửi tin nhắn cho khách
*   **Method & Route:** `POST /api/v1/inbox/conversations/:id/messages`
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('inbox.conversation.write')`
*   **Request Body (`CreateAgentMessageDto`):**
    ```typescript
    export class CreateAgentMessageDto {
      @IsString()
      @IsNotEmpty()
      content: string;

      @IsOptional()
      @IsEnum(['CONFIRMED_EVENT_UPDATE', 'HUMAN_AGENT'])
      tag?: 'CONFIRMED_EVENT_UPDATE' | 'HUMAN_AGENT'; // Đính kèm tag để gửi ngoài 24h
    }
    ```

### 3.4. API Sales tiếp quản cuộc hội thoại (Claim Chat)
*   **Method & Route:** `POST /api/v1/inbox/conversations/:id/claim`
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('inbox.conversation.write')`
*   **Response:** `{ success: true, assignee_id: string }`

### 3.5. API Tạo ghi chú nội bộ
*   **Method & Route:** `POST /api/v1/inbox/conversations/:id/comments`
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('inbox.conversation.write')`
*   **Request Body (`CreateInternalCommentDto`):**
    ```typescript
    export class CreateInternalCommentDto {
      @IsString()
      @IsNotEmpty()
      content: string; // Nội dung ghi chú (Ví dụ: "Khách cần tư vấn inverter, @Hoa_Tech hỗ trợ")
    }
    ```

### 3.6. API Lấy danh sách câu trả lời nhanh
*   **Method & Route:** `GET /api/v1/inbox/quick-replies`
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('inbox.conversation.read')`

---

## 4. Thiết Kế WebSocket Gateway (Socket.io Events)

Thiết lập một WebSocket Gateway trong NestJS (`InboxGateway`) để đẩy thông báo và đồng bộ trạng thái đụng độ thời gian thực:

```
[Sales Client A] ────► (Emit: client:typing) ────► [InboxGateway] ────► (Broadcast: server:typing_status) ────► [Sales Client B]
```

### 4.1. Danh sách các Events trao đổi:

#### 1. Đăng ký nhận sự kiện (Join Conversation Room)
*   **Event:** `client:join_room`
*   **Payload:** `{ conversationId: string }`
*   **Xử lý:** Server đưa socket connection của Sales vào một Room Socket có tên `conversation:<conversationId>`.

#### 2. Cảnh báo đang gõ tin nhắn (Typing Status)
*   **Event nhận từ Client:** `client:typing`
*   **Payload:** `{ conversationId: string, isTyping: boolean }`
*   **Event Server gửi đi (Broadcast):** `server:typing_status`
*   **Payload:** 
    ```json
    {
      "conversationId": "uuid-123",
      "agentId": "uuid-agent-A",
      "agentName": "Nguyễn Văn A",
      "isTyping": true,
      "expiresAt": 1718500000000 // Thời điểm tự động giải phóng lock (Unix timestamp ms)
    }
    ```

#### 3. Đồng bộ trạng thái gán cuộc chat
*   **Event Server gửi đi (Broadcast toàn hệ thống):** `server:conversation.assigned`
*   **Payload:** `{ conversationId: string, assigneeId: string, assigneeName: string }`

#### 4. Đẩy tin nhắn mới của khách / AI
*   **Event Server gửi đi (Broadcast vào room):** `server:message.new`
*   **Payload:** `{ id: string, sender_type: string, content: string, created_at: Date }`

#### 5. Bắn thông báo được Tag tên trong Ghi chú nội bộ
*   **Event Server gửi đi (Gửi trực tiếp đến User Socket):** `server:internal_comment.created`
*   **Payload:** `{ conversationId: string, commentId: string, taggedByName: string, briefContent: string }`

---

## 5. Đặc Tả API Quản Lý & Phân Quyền (REST APIs & ABAC)

### 5.1. API Lấy danh sách cuộc hội thoại cho Feed
*   **Method & Route:** `GET /api/v1/inbox/conversations`
*   **Quy chuẩn truy vấn:** Áp dụng `TypeOrmQueryHelper` xử lý phân trang, lọc và tìm kiếm.
*   *Search fields:* `conversation.customer_name`, `conversation.last_message_content`.
*   *Filter fields:* `state` (`AUTOMATIC` / `MANUAL`), `assignee_id` (Sales được gán), `channel` (`FACEBOOK` / `ZALO`).
*   *Sort fields:* `last_message_at`, `created_at`.
*   *Format đầu ra:* `PaginatedResponseDto<ConversationFeedDto>`.

### 5.2. API Lấy danh sách câu trả lời nhanh
*   **Method & Route:** `GET /api/v1/inbox/quick-replies`
*   **Quy chuẩn truy vấn:** Áp dụng `TypeOrmQueryHelper` xử lý phân trang, lọc và tìm kiếm.
*   *Search fields:* `quickReply.shortcut`, `quickReply.content`.
*   *Sort fields:* `shortcut`, `created_at`.
*   *Format đầu ra:* `PaginatedResponseDto<InboxQuickReplyEntity>`.

### 5.3. Thao tác tiếp quản và gửi tin nhắn (ABAC Checks)
*   **Claim Chat (`POST /inbox/conversations/:id/claim`):** Chỉ cho phép nếu cuộc hội thoại có trạng thái `MANUAL` và `assignee_id` đang rỗng (NULL).
*   **Gửi tin nhắn / Thảo luận nội bộ (`POST /inbox/conversations/:id/messages` hoặc `/comments`):** Chỉ cho phép nếu cuộc hội thoại có trạng thái `MANUAL` và `assignee_id` trùng khớp với `user.id` (hoặc là Admin/Manager bypass). Chặn đứng nếu đang ở trạng thái `AUTOMATIC` (để tránh tranh chấp với AI).

---

## 6. Đặc Tả ABAC Resource Hydrators của Module Agent Inbox
Để hỗ trợ `PermissionsGuard` kiểm tra trạng thái và quyền sở hữu cuộc trò chuyện mà không phụ thuộc trực tiếp vào DB của Chatbot/Inbox:

1.  **`ConversationHydrator` (Prefix nhận diện: `inbox.conversation`):**
    *   *Phương thức nạp:* `fetchResource(conversationId: string)`
    *   *SQL Select:* Chỉ lấy các trường `id`, `state`, `assignee_id`, `channel`.
    *   *Áp dụng:* Bảo vệ các API gửi tin nhắn, viết bình luận nội bộ, và nhận tiếp quản cuộc chat.

---
