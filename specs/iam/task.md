# Task Lập Trình Module IAM

- `[ ]` **Auth Service:** Viết luồng Hash Password (Bcrypt) và đăng nhập/cấp phát JWT Token.
- `[ ]` **JWT Strategy:** Viết Passport/Guard để xác thực Token trên mỗi HTTP request.
- `[ ]` **Permission Decorators:** Cài đặt các custom decorator để dán quyền lên Controller.
- `[ ]` **Dynamic Policy Engine:** Viết bộ parser để eval các chuỗi logic từ bảng `iam_policies`.
- `[ ]` **Audit Interceptor:** Viết NestJS Interceptor để tự động lưu vết các hành vi ghi/sửa trên module IAM xuống bảng `iam_role_audit_logs`.
