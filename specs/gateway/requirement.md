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
