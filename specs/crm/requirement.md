# Yêu Cầu Chức Năng Module CRM (Requirements)

## 1. Giới thiệu Module
Module CRM (Customer Relationship Management) đóng vai trò là "Hệ thần kinh trung ương" của Solavie, quản lý toàn bộ dữ liệu khách hàng, phễu bán hàng (pipeline), và theo dõi tương tác (Activity Timeline) từ lúc là khách hàng tiềm năng đến khi hoàn tất hợp đồng và hậu mãi.

## 2. Các yêu cầu nghiệp vụ chính (Business Requirements)

### 2.1. Single Customer View (Góc nhìn 360 độ)
- Hệ thống phải hợp nhất thông tin khách hàng từ nhiều kênh (Facebook, Zalo, Website) về một bản ghi duy nhất.
- Khi có sự trùng lặp số điện thoại, hệ thống phải tự động cảnh báo hoặc gộp hồ sơ.
- Quản lý toàn bộ lịch sử tương tác (nhắn tin với AI, gọi điện, thay đổi trạng thái) theo dạng Timeline liên tục.

### 2.2. Quản lý Thuộc tính Động (Dynamic Fields)
- Không hardcode các trường thông tin ngành Năng lượng mặt trời (như diện tích mái, hóa đơn tiền điện).
- Admin có thể tự do tạo, sửa, xóa các trường thông tin cấu hình mở rộng trên UI.
- Hỗ trợ các kiểu dữ liệu: TEXT, NUMBER, SELECT, DATE.

### 2.3. Phễu Bán Hàng Động (Dynamic Pipeline)
- Admin có thể cấu hình các cột trạng thái (Stages) của quy trình bán hàng.
- Mỗi trạng thái bao gồm: Màu sắc, tỷ lệ thành công (Win Probability %), thứ tự.
- Giao diện thao tác kéo-thả (Kanban Board) cho nhân viên Sales.
- Phải có cơ chế Ràng buộc dữ liệu (Entrance Criteria): Chỉ khi điền đủ các trường bắt buộc mới được kéo thẻ khách hàng sang cột tương ứng.

### 2.4. Chấm Điểm Tiềm Năng Bằng AI (Dynamic Lead Scoring)
- Tự động chấm điểm (Score) khách hàng dựa trên bộ luật (Rules) cấu hình động.
- Bộ luật hỗ trợ các toán tử logic: Lớn hơn, Nhỏ hơn, Bằng, Không rỗng.
- Phân loại khách hàng theo nhiệt độ: COLD (Thấp), WARM (Trung bình), HOT (Cao).
- Tự động phân bổ khách hàng HOT cho nhân viên Sales.

### 2.5. Tự động tính toán ROI Năng lượng Mặt trời
- Dựa trên diện tích mái, hóa đơn tiền điện và vị trí địa lý, hệ thống phải tự động tính toán được cấu hình hệ thống (kWp) phù hợp.
- Tính toán sản lượng điện sinh ra, tiền tiết kiệm và số năm hoàn vốn.
- Lưu kết quả tính toán vào hồ sơ khách hàng.

### 2.6. Audit Logging & Undo (Hoàn tác thay đổi dữ liệu)
- **Tự động lưu vết (Auto-Audit Logging):** Mọi hành động thêm, sửa, xóa trên các bảng dữ liệu cốt lõi (`crm_leads`, `crm_customers`, `crm_pipelines`) phải được ghi lại tức thời và bất đồng bộ vào nhật ký thay đổi (`crm_audit_logs`).
- **Lưu trữ Snapshot trạng thái:** Log audit phải chụp lại trạng thái cũ của bản ghi (`old_values`) và trạng thái mới (`new_values`) dưới dạng cấu trúc JSONB.
- **Hoàn tác (Undo) linh hoạt:** Cho phép Admin hoặc người dùng được phân quyền nhấn nút "Undo" để khôi phục nhanh dữ liệu về trạng thái trước đó.
- **Xử lý ràng buộc khi Undo:**
  - Khôi phục chính xác các mối quan hệ (ví dụ: khôi phục lead bị xóa soft delete).
  - Trả về lỗi rõ ràng nếu vi phạm ràng buộc cơ sở dữ liệu (ví dụ: số điện thoại trùng lặp).
- **Vết log Undo:** Mọi hành vi Undo phải được ghi nhận là một hành động `UNDO` trong audit log để phục vụ mục đích kiểm toán và truy vết.

### 2.7. Kiểm soát Tranh chấp Dữ liệu bằng Khóa Phân Tán (Distributed Redis Lock)
- **Chống Race Condition khi Gộp Hồ Sơ:** Khi có nhiều luồng hoặc tiến trình (ví dụ: các webhook nhận tin nhắn đồng thời từ Facebook và Zalo của cùng một khách hàng có số điện thoại giống nhau) cố gắng cập nhật hoặc gộp hồ sơ (Merge Profile) cùng lúc, hệ thống phải thực hiện khóa phân tán (Distributed Lock) dựa trên số điện thoại để ngăn chặn tình trạng ghi đè hoặc tạo các bản ghi rác bị trùng lặp.
- **Tính Bền Vững của Lock:** Khóa phải được lưu trữ trên instance Redis có chính sách bộ nhớ `noeviction` để đảm bảo cờ khóa không bao giờ bị giải phóng nhầm khi RAM đầy.
- **Xử lý Timeout và Chờ Lock (Backoff):** Tiến trình gộp hồ sơ nếu gặp trạng thái khóa đang bị chiếm dụng phải tự động chờ (Retry/Backoff) hoặc bỏ qua nếu là tin nhắn trùng lặp để giảm tải cho hệ thống DB.

### 2.8. Ghi chú Khách hàng (Customer Take-Note)
- **Quản lý ghi chú cá nhân:** Nhân viên Sales được phân vai phụ trách (`assignee_id`) hoặc có quyền `crm:notes:write` có thể tạo ghi chú viết tay cho khách hàng.
- **Tính năng Ghim (Pin Note):** Cho phép ghim các ghi chú quan trọng lên đầu danh sách để đập vào mắt Sales Rep khi truy cập hồ sơ khách hàng hoặc mở khung chat liên quan.
- **Tính chỉnh sửa/xóa linh hoạt:** Khác với nhật ký hoạt động bất biến, Sales Rep có thể tự chỉnh sửa hoặc xóa ghi chú của chính mình. Admin có quyền chỉnh sửa/xóa tất cả các ghi chú.
- **Tích hợp Audit Log:** Mọi hành động thêm, sửa, xóa ghi chú khách hàng phải được lưu vết trong `crm_audit_logs` để phục vụ mục đích kiểm toán và hỗ trợ khả năng hoàn tác (`undo`).

### 2.9. Phát Sự Kiện Thông Báo Nội Bộ (Event-Driven Notification)

> **Nguyên tắc kiến trúc:** CRM Module không tự gửi thông báo trực tiếp. Mọi hành động nghiệp vụ quan trọng phải phát sự kiện qua Event Bus nội bộ và Module Notification đảm nhận việc phân phối đến đúng người nhận qua đúng kênh.

- **`lead.assigned`**: Phát khi Admin/Manager gán hoặc chuyển giao Lead cho một Sales Rep mới. Payload bao gồm: `leadId`, `leadName`, `leadPhone`, `assigneeId`, `assigneeEmail`.
- **`lead.score_hot`**: Phát khi AI Scoring Engine tính toán và Lead đạt ngưỡng nhiệt độ HOT. Payload bao gồm: `leadId`, `leadName`, `leadScore`, `assigneeId`, và `managerId` (nếu có).
- **`lead.status_changed`**: Phát khi Sales kéo thẻ Lead sang một stage mới trên Kanban Board. Payload bao gồm: `leadId`, `leadName`, `assigneeId`, `oldStageName`, `newStageName`.
- **`customer.note_mentioned`**: Phát khi một nhân viên gõ `@username` trong ghi chú khách hàng. Payload bao gồm: `customerId`, `mentionedUserId`, `mentionerName`, `noteSnippet`.

### 2.10. Cơ chế Gộp Hồ Sơ Tự Động (MergeProfileService Requirements)
- Khi Chatbot/Inbox trích xuất được số điện thoại từ hội thoại của khách, hệ thống tự động kiểm tra trùng lặp trong DB.
- Nếu SĐT đã tồn tại trên một Customer/Lead khác, kích hoạt quy trình gộp hồ sơ tự động:
  - **Duy trì bản ghi chính (Master Profile):** Bản ghi được tạo đầu tiên hoặc bản ghi đã được xác thực (AI Qualified / Sales Rep assigned) được chọn làm Master Profile. Bản ghi phụ (Zalo/Facebook profiles rác mới tạo) sẽ bị gộp vào Master Profile và soft-deleted.
  - **Gộp thông tin cá nhân:** Hợp nhất Họ tên (ưu tiên chuỗi dài hơn, viết hoa chuẩn), Email, Địa phương.
  - **Gộp thuộc tính nhu cầu Solar (Custom Fields):** Nếu xảy ra xung đột dữ liệu (ví dụ: Master Profile ghi hóa đơn 2 triệu, Profile phụ ghi hóa đơn 3 triệu), ưu tiên lấy dữ liệu mới nhất, đồng thời lưu vết giá trị cũ bị ghi đè vào một ghi chú viết tay (`crm_customer_notes`) gắn thẻ "SYSTEM_MERGE_OVERWRITE" để Sales Rep có thể tham chiếu lại.
  - **Hợp nhất Lịch sử Chat & Hoạt động (Timeline Merge):** Chuyển toàn bộ hội thoại (`chat_conversations`) và nhật ký hoạt động (`crm_activities`) của Profile phụ sang Master Profile bằng cách cập nhật `customer_id` tương ứng.
  - **Bảo vệ bằng khóa phân tán (Distributed Lock):** Bắt buộc chạy qua Redis Lock `lock:merge:phone:${phone}` để tránh đụng độ luồng dữ liệu khi webhook FB và Zalo OA gửi sự kiện cùng lúc.
