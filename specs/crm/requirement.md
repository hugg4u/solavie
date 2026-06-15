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
