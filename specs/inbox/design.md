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
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('chat:read')`
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
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('chat:read')`
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
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('chat:write')`
*   **Request Body (`CreateAgentMessageDto`):**
    ```typescript
    export class CreateAgentMessageDto {
      @IsString()
      @IsNotEmpty()
      content: string;
    }
    ```

### 3.4. API Sales tiếp quản cuộc hội thoại (Claim Chat)
*   **Method & Route:** `POST /api/v1/inbox/conversations/:id/claim`
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('chat:write')`
*   **Response:** `{ success: true, assignee_id: string }`

### 3.5. API Tạo ghi chú nội bộ
*   **Method & Route:** `POST /api/v1/inbox/conversations/:id/comments`
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('chat:write')`
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
*   **Guard/Permission:** `JwtAuthGuard`, `RequirePermissions('chat:read')`

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
