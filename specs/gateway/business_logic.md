# Đặc Tả Business Logic Module Gateway

## 1. Xác Thực Chữ Ký (Signature Verification)
Bảo vệ hệ thống bằng thuật toán HMAC-SHA256 trên Fastify Middleware.
- **Facebook**: Header `x-hub-signature-256`. Tính băm của raw body bằng App Secret.
- **Zalo OA**: Header `x-ze-signature`. Tính băm chuỗi `appId + rawBody + timestamp` bằng Zalo Secret Key.

## 2. Xử Lý Bất Đồng Bộ (Non-blocking Flow)
- Nhận HTTP POST Request từ Facebook/Zalo.
- Extract Payload -> Verify Signature.
- Transform data thành đối tượng `UnifiedMessage`.
- Push vào Redis Queue `msg_queue`.
- Ngay lập tức return HTTP 200 OK (Đảm bảo < 50ms).
- Không để Facebook/Zalo phải chờ AI RAG trả lời (tránh Timeout sau 2s).

## 3. Worker Subscribe Queue
- Module Chatbot đóng vai trò Worker, subscribe vào `msg_queue`.
- Pop tin nhắn ra, xử lý Intent, RAG. Sau khi có kết quả sinh Text từ LLM, Worker sẽ gọi API "Send Message" của Facebook/Zalo để gửi tin lại cho khách hàng.
