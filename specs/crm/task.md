# Task Lập Trình Module CRM (Developer Tasks)

- `[ ]` **Setup Entity & Migration:** Khởi tạo các TypeORM Entities cho `crm_customers`, `crm_stages`, `crm_field_definitions`, `crm_scoring_rules`, `crm_activities`.
- `[ ]` **CRUD Configuration:** Viết các APIs cho Admin cấu hình Fields, Stages, Rules.
- `[ ]` **Dynamic Pipeline Logic:** Implement Service Layer kiểm tra Entrance Criteria khi đổi Stage.
- `[ ]` **Merge Logic:** Implement Service gom nhóm hồ sơ trùng số điện thoại.
- `[ ]` **ROI Calculator Service:** Cài đặt công thức tính toán Solar dựa trên cấu hình Vùng miền.
- `[ ]` **Scoring Engine:** Viết logic eval (đánh giá) điểm dựa trên `crm_scoring_rules`.
- `[ ]` **Activity Observer:** Viết Subscribers lắng nghe Event để tự động ghi log vào `crm_activities`.
- `[ ]` **Audit Database Setup:** Tạo migration và TypeORM Entity cho bảng `crm_audit_logs` để lưu trữ snapshot thay đổi dạng JSONB.
- `[ ]` **TypeORM Audit Subscriber:** Viết `CrmAuditSubscriber` để tự động bắt các sự kiện ghi dữ liệu của các bảng được cấu hình và lưu snapshot.
- `[ ]` **CRM Audit & Undo API:** Xây dựng các API `GET /api/v1/crm/audit-logs` và `POST /api/v1/crm/audit-logs/:id/undo` kèm phân quyền check quyền `crm:undo`.
- `[ ]` **Undo Transaction Service:** Viết `CrmUndoService` xử lý khôi phục dữ liệu an toàn dựa trên snapshot, đảm bảo chạy trong database transaction và bắt lỗi ràng buộc cơ sở dữ liệu.
