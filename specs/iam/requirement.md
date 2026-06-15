# Yêu Cầu Chức Năng Module IAM (Identity & Access Management)

## 1. Giới thiệu Module
Module IAM đảm nhận vai trò quản lý danh tính (Tài khoản nhân viên, Admin), cấp phát phiên bản đăng nhập (Authentication) và phân quyền kiểm soát truy cập linh hoạt (Authorization) vào toàn bộ hệ thống API.

## 2. Yêu cầu nghiệp vụ

### 2.1. Authentication (Xác thực người dùng)
- Đăng nhập/Đăng xuất qua JWT (JSON Web Token).
- Cấp phát Access Token (thời hạn ngắn) và Refresh Token (thời hạn dài).
- Lưu trữ mật khẩu dạng băm an toàn.

### 2.2. Authorization (Phân quyền kiểm soát truy cập)
- Hỗ trợ Role-Based Access Control (RBAC): Các role cứng như `ADMIN`, `SALES`, `MANAGER`.
- Hỗ trợ Attribute-Based Access Control (ABAC): Quyền động dựa trên thuộc tính dữ liệu. Ví dụ: Sales chỉ được xem và sửa khách hàng do mình được gán (assignee_id).
- Cấu trúc quyền (Permissions) phải chia theo từng action rõ ràng (Ví dụ: `lead:read`, `lead:create`, `lead:delete`).

### 2.3. Audit Trail (Ghi vết thay đổi quyền hạn)
- Bất kỳ Admin nào thực hiện thay đổi Role, cấp thêm hay xóa bớt Permission của một người dùng khác đều phải được lưu trữ vào hệ thống Audit Log không thể xóa.
