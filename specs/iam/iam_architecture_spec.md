# Kiến trúc & Đặc tả Module IAM (Identity and Access Management)

**Dự án:** Solavie
**Phân hệ:** IAM (Authentication, Authorization, Event Logging)
**Mô hình thiết kế:** Modular, Event-Driven, Spec-Driven Development (SDD)

## 1. Tổng Quan Kiến Trúc (Architecture Overview)

Module IAM quản lý 100% vòng đời của tài khoản người dùng, định danh và cấp quyền truy cập. Nó được thiết kế dựa trên mô hình lai (Hybrid) kết hợp bảo mật chặt chẽ và khả năng mở rộng nhanh qua Redis & BullMQ.

### Các cấu phần lõi:
- **Authentication (AuthService):** Quản lý Đăng nhập (Login), Làm mới token (Refresh), Khởi tạo tài khoản (Activate).
- **Authorization (PermissionService & PermissionsGuard):** ABAC & RBAC. Cache quyền bằng Redis. 
- **Outbox Processing (IamOutboxProcessor):** Bảo vệ tính toàn vẹn dữ liệu sự kiện giữa Postgres và BullMQ.

## 2. Mô Hình Dữ Liệu (Entity Relationship)

- **UserEntity:** Bảng cốt lõi chứa thông tin định danh (Email, Password Hash). Mật khẩu bắt buộc >=8 ký tự, có chữ hoa, thường và số.
- **RoleEntity & PermissionEntity:** Bảng định nghĩa vai trò và danh mục quyền hạn hệ thống (ví dụ: `iam.users.create`).
- **PolicyEntity:** Đóng vai trò kết nối Role và Permission thông qua biểu thức logic (Rule Expression) dạng `JSONLogic` để thực thi quyền theo ngữ cảnh (ABAC).
- **IamDeviceHistoryEntity:** Ghi nhận lịch sử thiết bị đăng nhập theo mã băm (Hash) của IP & User-Agent.
- **IamOutboxEntity:** Ghi nhận sự kiện xuất hệ thống để chờ BullMQ gửi đi, tránh mất dữ liệu khi Queue có vấn đề.

## 3. Luồng Xác Thực (Authentication Flow)

Hệ thống áp dụng **Refresh Token Rotation (RTR)**.
- **Cơ chế Token:**
  - Access Token: JWT, sống ngắn hạn (ví dụ: 15 phút), chứa `sub` và `email`.
  - Refresh Token: Chuỗi Hex 32 byte mã hóa ngẫu nhiên (Opaque Token), sống dài hạn (ví dụ: 7 ngày), lưu trữ trong HttpOnly Cookie và Redis.
- **Cơ chế Cookie:** HttpOnly, SameSite=Strict, Path cố định cho route `/api/v1/iam/auth`.
- **RTR Grace Period:** Khi refresh token được sử dụng, nó đánh dấu `isUsed = true`. Nếu có Request trùng lặp gửi lên trong 30 giây (Grace period) cùng token cũ, hệ thống vẫn cấp lại chuỗi token trước đó để tránh rủi ro Race Condition ở Frontend. Qua 30 giây, bất kỳ token cũ nào tái sử dụng sẽ kích hoạt **Breach Detection** -> Xóa lập tức toàn bộ phiên làm việc của user (Revoke All Sessions).

## 4. Luồng Phân Quyền (ABAC/RBAC)

1. **Khởi động:** Guard `PermissionsGuard` (áp dụng toàn cục) kiểm tra Token.
2. **Kiểm tra Cache:** Tra cứu Redis Key `iam:user_permissions:{userId}`.
3. **Truy vấn DB (nếu Cache Miss):** Lấy danh sách Roles -> Policies -> Permissions. Dữ liệu được biên dịch thành dạng Hashmap: `{"action": ["rule_1", "rule_2"]}`.
4. **JSONLogic Evaluation:** Nếu hành động cần quyền `iam.users.create`, Guard sẽ lấy Data Context (body, params) và chạy hàm đánh giá của `json-logic-js`. Nếu kết quả `true`, request được đi tiếp.
5. **Vô hiệu hóa Cache:** Mọi thay đổi về Role từ quản trị viên (UpdateUser) sẽ trigger xóa Cache tương ứng lập tức.

## 5. Cơ Chế Chống Lỗi (Idempotency & Resilience)

- **Database Concurrency:** Sử dụng Row-level Lock (`pessimistic_write`) khi Worker xử lý các hàng đợi Outbox, triệt tiêu Double-processing.
- **Queue Fault-Tolerance:** Đẩy Queue (`outboxQueue.add`) luôn được đặt trong `try/catch`. Nếu Redis/BullMQ gián đoạn, API không văng lỗi 500, dữ liệu vẫn được commit vào Postgres và tự động Polling (quét lại) khi hệ thống Queue phục hồi.
- **API Versioning:** URI Versioning chuẩn NestJS (`/api/v1/...`). Các Controllers nằm trong thư mục chia nhỏ theo phiên bản nhưng tái sử dụng nguyên vẹn Core Services.
