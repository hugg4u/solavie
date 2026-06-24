# Solavie Platform — System Inbox Pattern & Idempotency Guard

| Tài liệu | Hệ Thống — Inbox Pattern & Idempotency Standard |
|---|---|
| Mức độ | **BẮT BUỘC (CRITICAL)** |
| Trạng thái | Đang áp dụng (Active) |
| Module áp dụng | Gateway, CRM, Booking, Chatbot, Notification, IAM, Storage |

> **Mục tiêu của Inbox Pattern:** Đảm bảo tính **Idempotency** (Tính Đẳng Cấu / Không Trùng Lặp) cho hệ thống Microservices. Tuyệt đối không cho phép một giao dịch (đặt lịch, lưu hồ sơ, thanh toán, gửi thông báo) bị thực thi nhiều hơn 1 lần dù hệ thống bị mất mạng, retry liên tục hay người dùng click đúp (Double-Click).

---

## 1. Inbox Pattern là gì?

Khác với Outbox Pattern (đặt ở phía người GỬI), **Inbox Pattern** được đặt tại phía người NHẬN (Consumer hoặc API Server).

Inbox Pattern lưu lại dấu vết (Fingerprint) của một sự kiện/yêu cầu đã được xử lý. Nếu một sự kiện tương tự bay tới, hệ thống sẽ đối chiếu với Inbox và **từ chối xử lý lại (Bỏ qua an toàn - Graceful Ignore)**.

Trong hệ thống Solavie, Inbox Pattern được phân ra làm 2 hình thái cụ thể:
1. **Event Inbox (Message Queue Idempotency)**
2. **API Idempotency (HTTP Header Idempotency)**

---

## 2. Hình thái 1: Event Inbox (Message Queue Idempotency)

Áp dụng khi một Module đóng vai trò là **Consumer** nhận Event từ BullMQ (được đẩy từ Outbox của module khác). Message Broker bản chất là **At-Least-Once Delivery** (Gửi ít nhất 1 lần, có thể bị gửi trùng do network flap).

### 2.1 Luật Bắt Buộc (The Golden Rule)
- Bất kỳ event payload nào được định nghĩa trong `system_events.md` đều PHẢI có thuộc tính `eventId: string` (UUID v4).
- Module nhận event **BẮT BUỘC** phải kiểm tra `eventId` này TRƯỚC KHI thực thi logic.

### 2.2 Kiến trúc Triển Khai (Consumer-side)
1. **Database Approach (Cách An Toàn Nhất):** 
   - Tạo một bảng `[module]_inbox_events` (VD: `notification_inbox_events`).
   - Cột `event_id` là `PRIMARY KEY` (hoặc `UNIQUE INDEX`).
   - Khi nhận Event, mở DB Transaction: `INSERT INTO inbox_events (event_id) VALUES (...)`.
   - Nếu `INSERT` bị văng lỗi `Unique Constraint Violation` → Nghĩa là Event này đã được xử lý. Catch lỗi và return `ACK` (thành công) cho BullMQ để xóa message khỏi hàng đợi (Bỏ qua an toàn).

2. **Redis Approach (Cách Tốc Độ Cao):**
   - Chỉ dùng cho các logic không có Transaction DB (như gửi SMS, gửi Email).
   - Dùng Redis: `SET NX lock:event:{eventId} 1 EX 604800` (Khóa trong 7 ngày).
   - Nếu trả về `0` (False) → Sự kiện đã được xử lý → Bỏ qua an toàn.

---

## 3. Hình thái 2: API Idempotency (Bảo vệ từ Front-End)

Áp dụng cho các **HTTP API quan trọng** (POST, PUT, PATCH) để chống trường hợp Front-End/App lỗi gọi API 2 lần, hoặc người dùng tức giận click nút Submit nhiều lần liên tiếp.

### 3.1 Giao thức Header
- Client (Frontend/App) khi gọi API phải tự sinh ra một UUID v4 ngẫu nhiên và đính kèm vào Header: 
  `Idempotency-Key: <UUID>`
- API Server sẽ đọc Header này.

### 3.2 Quy trình Xử lý (API Guard)
Hệ thống Solavie cung cấp một Global Idempotency Interceptor (cấu hình trong `system_master_task.md` **SYS-BOOT-11**).

1. Request tới mang theo `Idempotency-Key: X`.
2. Interceptor gọi Redis: `SET NX idempotency:{api_path}:{X} 1 EX 86400` (Khóa trong 24h).
3. Nếu Redis trả về `0` (Key đã tồn tại):
   - Ném lỗi `HTTP 409 Conflict` (Lỗi do Client gửi trùng).
   - Hoặc (Nâng cao): Lưu sẵn kết quả HTTP Response của lần gọi trước vào Redis, sau đó trả thẳng kết quả cũ (Cached Response) ra cho Client. (Triết lý: *Gọi 100 lần kết quả vẫn như gọi 1 lần*).
4. Nếu Redis trả về `1` (Key chưa tồn tại) → Cho phép xử lý API.

> **Trường hợp áp dụng bắt buộc:**
> - Thanh toán (Payments).
> - Đặt lịch hẹn (Booking / Appointment).
> - Phân bổ Leads (CRM Assignment).
> - API Xác nhận Upload File (Storage Confirm).

---

## 4. Đặc tả Kỹ thuật Triển khai theo Module

Dưới đây là sơ đồ nhiệm vụ của từng module để tuân thủ Inbox Pattern:

| Module | Phạm vi Idempotency | Cách xử lý đặc tả |
|---|---|---|
| **Notification** | Tránh gửi 2 tin nhắn/email/Zalo cho 1 thông báo. | Bảng `notification_inbox` + SHA256 Key generation từ `eventId`. |
| **Storage** | Tránh Confirm File Upload 2 lần, gây lỗi Copy Object trên MinIO. | Header `Idempotency-Key` + Redis `SET NX` TTL 1h. |
| **Gateway / Chatbot** | Tránh nhận 2 Webhook trùng từ Facebook/Zalo làm AI trả lời 2 lần. | Header `Idempotency-Key` (dựa trên Webhook ID) + Redis `SET NX`. API Handback cũng áp dụng. |
| **Booking** | Tránh User Click đúp tạo ra 2 lịch hẹn trùng giờ. | Header `Idempotency-Key` trên API `POST /appointments`. |
| **CRM** | Tránh tạo Lead trùng do Chatbot bị Retry hoặc Webhook trùng lặp. | Check `eventId` trong bảng `crm_inbox` trước khi nhập hồ sơ. |

---

## 5. Cấu trúc Bảng `[module]_inbox_events` Tiêu Chuẩn

Nếu Module của bạn chọn giải pháp lưu Inbox vào Database (PostgreSQL), hãy sử dụng cấu trúc DDL mẫu sau:

```sql
CREATE TABLE [module]_inbox_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id VARCHAR(255) UNIQUE NOT NULL, -- Dùng làm Unique Constraint chặn trùng lặp
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_[module]_inbox_event_id ON [module]_inbox_events(event_id);
```

**Bảo Tôn Hoàng Gia:** Tuyệt đối tuân thủ, không bao giờ được phép dùng `any` trong việc parse payload từ Event Inbox! Mọi payload phải đi qua validation pipe hoặc zod validation.

---

## 6. Đặc tả Định Tuyến Tin Nhắn Đầu Vào (Hybrid Inbox Routing)

Hộp thư đầu vào của Chatbot Module áp dụng cơ chế định tuyến lai (Hybrid Routing) kết hợp kịch bản tĩnh (Flows) và AI Agent dựa trên trạng thái hội thoại (`bot_state`) lưu trữ trong bảng `chat_conversations`.

### 6.1. Ba Trạng Thái Hội Thoại (`bot_state`)

1.  **`MANUAL` (Chat tay):** Nhân viên Sales đang trực tiếp tiếp quản cuộc trò chuyện. Toàn bộ chatbot (tự động hóa và AI) bị vô hiệu hóa hoàn toàn trên phiên chat này.
2.  **`FLOW_EXECUTING` (Chạy kịch bản tĩnh):** Hệ thống đang dẫn dắt khách hàng qua các node của một Flow đã được kích hoạt.
3.  **`AUTOMATIC` (AI Agent tự động):** AI Agent RAG tiếp quản tư vấn tự do cho khách hàng.

### 6.2. Thuật Toán Định Tuyến Tin Nhắn Nhận Được

Mỗi khi nhận được tin nhắn từ khách hàng (`message.received`):

```
                        [Nhận Tin Nhắn Khách Hàng]
                                    │
                                    ▼
                      Khớp từ khóa trong cấu hình
                        `chat_keywords`?
                       /                \
                    (Có)               (Không)
                     /                    \
     [Chuyển bot_state = FLOW_EXECUTING]   Kiểm tra bot_state hiện tại:
     [Kích hoạt Flow Executor]               ├─► MANUAL ──► Chuyển Inbox UI cho Sales
                                             ├─► AUTOMATIC ──► Chạy AI Agent (RAG)
                                             └─► FLOW_EXECUTING ──► [Kiểm tra đầu vào]
```

1.  **Khớp từ khóa kích hoạt:** Hệ thống chạy tin nhắn qua `KeywordRouterService`. Nếu khớp từ khóa tĩnh, hệ thống lập tức cập nhật `bot_state = FLOW_EXECUTING`, hủy các hàng đợi sequence cũ (nếu có), và chuyển tin nhắn vào `FlowExecutorService` để chạy kịch bản tương ứng bắt đầu từ Node Root.
2.  **Xử lý theo trạng thái hiện tại (nếu không khớp từ khóa):**
    -   **Trường hợp `bot_state = MANUAL`:** 
        -   Bỏ qua chatbot hoàn toàn.
        -   Đồng bộ tin nhắn trực tiếp lên giao diện Livechat của Sales qua WebSocket.
        -   Đặt lại mốc cảnh báo warning badge 24h của cuộc chat.
    -   **Trường hợp `bot_state = AUTOMATIC`:**
        -   Chuyển tin nhắn vào hàng đợi debounce Redis `buffer:conversation:${conversationId}` trong 3 giây (để gom tin double-text).
        -   Kích hoạt `AI_Agent_Service` thực hiện RAG search và suy luận LLM để trả lời khách hàng.
    -   **Trường hợp `bot_state = FLOW_EXECUTING`:**
        -   Hệ thống kiểm tra tin nhắn khách hàng gửi lên:
            -   *Nếu khách hàng bấm nút, chọn carousel (tin nhắn dạng payload/button click khớp với các lựa chọn `next_node_id` của node hiện tại):* Tiếp tục thực thi node tiếp theo trong kịch bản.
            -   *Nếu khách hàng gõ văn bản tự do (free-text) không khớp bất kỳ nút lựa chọn nào:* Kích hoạt cơ chế **Giải phóng kịch bản (Flow Release)**:
                1. Tạm dừng thực thi kịch bản tĩnh.
                2. Chuyển trạng thái hội thoại thành `bot_state = AUTOMATIC`.
                3. Gửi tin nhắn đầu vào sang cho AI Agent xử lý ngay lập tức để AI trả lời linh hoạt câu hỏi tự do của khách.

### 6.3. Bàn Giao (Handover) & Tiếp Quản Lại (Handback)

-   **Bàn giao cho Sales (Handover):** AI Agent tự động chuyển đổi `bot_state = MANUAL` khi phát hiện các tín hiệu:
    -   Khách yêu cầu gặp người hỗ trợ: *"gặp nhân viên"*, *"nói chuyện với tổng đài viên"*.
    -   AI Agent gặp lỗi logic hoặc ảo giác (Hallucination Guard cảnh báo lỗi đầu ra).
    -   Hệ thống tự động bắn sự kiện `chat.handover_requested` để thông báo cho nhân viên.
-   **Bàn giao lại cho Bot (Handback API):** Nhân viên Sales sau khi xử lý xong có thể click nút "Bàn giao lại cho AI" trên giao diện Inbox Portal. API `POST /api/v1/chatbot/conversations/:id/handback` sẽ kiểm tra quyền ABAC và chuyển `bot_state` về `AUTOMATIC` để Bot tiếp tục trực ca.

