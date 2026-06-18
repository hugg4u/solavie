# Yêu Cầu Chức Năng Module Gateway (Requirements)

## 1. Giới thiệu Module
Module Gateway đóng vai trò làm API Gateway và Omnichannel Webhook Receiver. Mọi tin nhắn từ Facebook Messenger, Zalo OA hay Website Chat Widget đều phải đi qua đây trước khi vào hệ thống nội bộ.

## 2. Yêu cầu nghiệp vụ

### 2.1. Tiếp nhận Webhook Đa Kênh
- Lắng nghe và tiếp nhận event tin nhắn từ nhiều nguồn MXH.
- Giải quyết bài toán tốc độ phản hồi: Phải trả về HTTP 200 OK cho MXH trong vòng dưới 2 giây để tránh bị Timeout / Retry.

### 2.2. Chuẩn hóa dữ liệu (Normalization)
- Biến đổi các payload đặc thù của Facebook, Zalo thành một định dạng duy nhất (UnifiedMessage) để AI và CRM bên trong hệ thống có thể xử lý đồng nhất mà không cần quan tâm tin nhắn đến từ đâu.

### 2.3. Xác thực Chữ ký (Signature Verification)
- Xác thực tính hợp lệ của Webhook đến từ Facebook/Zalo (Ngăn chặn tấn công giả mạo).

### 2.4. Khả năng chịu tải (High Throughput)
- Ứng dụng mô hình Message Broker (Redis Queue / Kafka) để đệm các request lúc cao điểm, không để request đè sập AI Engine.

### 2.5. Đảm bảo Giao nhận Tin nhắn (Transactional Outbox)
- Để tránh mất mát tin nhắn khi hệ thống hàng đợi Redis hoặc BullMQ gặp sự cố ngắt kết nối, Gateway bắt buộc phải ghi nhận mọi sự kiện webhook đầu vào vào cơ sở dữ liệu trước khi đẩy vào queue.
- Có cơ chế background worker quét và tự động đẩy lại (Retry) các tin nhắn bị kẹt ở trạng thái `PENDING` để đảm bảo phân phối tin nhắn thành công ít nhất một lần (At-least-once Delivery).

### 2.6. Bảo mật lưu trữ Credentials (AES-256-GCM)
- Toàn bộ thông tin nhạy cảm của các kênh liên kết (Zalo App Secret, Facebook Page Access Token) lưu trong database phải được mã hóa đối xứng bằng thuật toán **AES-256-GCM** để chống rò rỉ khi database bị lộ.
- Khóa giải mã và vector khởi tạo không được lưu trữ trong DB mà phải truyền qua biến môi trường hệ thống.

### 2.7. Tối ưu hóa hạ tầng đệm (Redis & BullMQ Isolation & Pooling)
- **Cô lập tài nguyên (Isolation):** Gateway bắt buộc phải sử dụng instance Redis độc lập cho BullMQ (`REDIS_QUEUE_URL`) chạy ở chế độ `noeviction` để tránh việc Redis tự ý giải phóng các key hàng đợi khi RAM bị đầy.
- **Chia sẻ kết nối (Connection Pooling):** Tái sử dụng TCP connection của `ioredis` để giảm thiểu overhead bắt tay TCP khi khởi tạo hàng đợi.
- **Dọn dẹp bộ nhớ (Job Retention):** Cấu hình tự động xóa các job đã hoàn thành (`removeOnComplete`) hoặc job thất bại quá hạn (`removeOnFail`) để bảo vệ RAM của Redis không bị phình to theo thời gian.

### 2.8. API Quản lý & Giám sát LLM Providers
- **Lấy danh sách Hãng LLM được hỗ trợ (Supported Providers):** Cung cấp API endpoint lấy danh sách tĩnh từ codebase của các hãng LLM và cấu hình Prompt Caching của chúng. Mục đích phục vụ danh sách chọn trên Admin UI.
- **Lấy danh sách cấu hình thực tế (Configured Providers):** Cung cấp API endpoint truy vấn danh sách các provider instance được thiết lập trong DB cùng trạng thái hoạt động và thứ tự ưu tiên.
- **Bảo mật Credentials:** API lấy danh sách cấu hình tuyệt đối không được trả về dữ liệu API key giải mã hoặc mã hóa dạng thô để chống rò rỉ (phải thực hiện ẩn hoặc mask chuỗi).
- **Tối ưu hóa hiệu năng:** Áp dụng cache Redis cho danh sách provider cấu hình để tránh nghẽn truy vấn Postgres khi hệ thống AI chat nhận request liên tục ở quy mô lớn.

### 2.9. API Quản lý Biến Dynamic Prompt cho Admin (Prompt Variables Management)
- **Quản lý biến động:** Cung cấp API endpoint để Admin cập nhật và truy vấn danh sách các biến động chèn vào prompt (ví dụ: `hotline_number`, `promo_info`, `tone_of_voice`).
- **Phòng chống Prompt Injection:** Áp dụng kiểm duyệt dữ liệu đầu vào nghiêm ngặt (Strict Input Validation) thông qua DTOs và Zod Schemas. Ngăn chặn lưu trữ các biến chứa từ khóa bẻ khóa prompt độc hại như `Ignore previous instructions`, `System developer mode`, `Reset system rules`...
- **Redis Caching:** Kết quả truy vấn biến prompt phải được cache vào Redis (`REDIS_CACHE_URL`) với TTL **300 giây (5 phút)** để tránh nghẽn database khi LLM Generator gọi liên tục cho từng tin nhắn chat. Cần invalidate cache Redis tức thì ngay khi Admin thực hiện cập nhật biến qua Portal.


