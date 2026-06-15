# Đặc Tả Business Logic Module IAM

## 1. Logic Xác Thực JWT
- Khi đăng nhập thành công, server trả về:
  - `access_token`: Ký bằng thuật toán HS256, thời hạn 15 phút. Trong Payload chứa User ID và danh sách Permissions tĩnh của User đó (Cache để không cần query DB mỗi request).
  - `refresh_token`: Lưu trong DB hoặc cache (Redis) với thời hạn 7 ngày, dùng để sinh ra access token mới.

## 2. Logic Phân Quyền (Guard Evaluation)
Khi request chạm vào API (ví dụ `GET /api/v1/crm/customers/1` yêu cầu quyền `lead:read`):
1. **JWT Verification**: Parse JWT, kiểm tra tính hợp lệ và thời hạn.
2. **RBAC Check**: Lấy danh sách Permissions trong JWT Payload. Nếu có `lead:read` thì đi tiếp, không có chặn `HTTP 403 Forbidden`.
3. **ABAC Check (Dynamic Guard)**: Nếu API yêu cầu check Policy động (chỉ được xem khách của mình):
   - Guard sẽ query DB lấy bản ghi `customer` số 1.
   - Load expression từ `iam_policies`.
   - Đánh giá biểu thức: `user.id === customer.assignee_id`. Nếu TRUE cho phép, FALSE chặn `HTTP 403`.
