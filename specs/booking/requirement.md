# Yêu Cầu Chức Năng Module Đặt Lịch Hẹn (Requirements)

## 1. Giới thiệu Module
Module Đặt Lịch Hẹn (Scheduling/Booking Module) chịu trách nhiệm tự động hóa quy trình lên lịch gặp gỡ, khảo sát thực địa và tư vấn giữa khách hàng và chuyên viên Sales của Solavie, tích hợp đồng bộ dữ liệu chặt chẽ với hệ thống Chatbot AI và Solar CRM.

---

## 2. Các yêu cầu nghiệp vụ chính (Business Requirements)

### 2.1. Cấu hình Lịch rảnh cá nhân (Sales Availability)
- Mỗi nhân viên Sales có quyền tự định nghĩa thời gian rảnh làm việc của mình trong tuần (ví dụ: Thứ Hai - Thứ Sáu, từ 08h00 đến 12h00 và từ 13h30 đến 17h30).
- Hệ thống hỗ trợ chia nhỏ lịch rảnh theo từng ngày cụ thể và hỗ trợ cấu hình ngày nghỉ lễ (ngày bận đột xuất).

### 2.2. Định nghĩa Loại cuộc hẹn (Event Types / Meeting Templates)
- **Cấu hình tập trung (Pure Admin-configured)**: Admin có toàn quyền cấu hình các kịch bản cuộc hẹn mẫu của công ty nhằm đảm bảo tính chuẩn hóa của phễu CRM và khả năng nhận diện ý định của AI Chatbot. Quy trình này cấm Sales tự do tạo loại sự kiện cá nhân để tránh nhiễu loạn dữ liệu. Các tham số cấu hình mẫu bao gồm:
  - *Tên sự kiện:* (Ví dụ: "Khảo sát thực địa hệ pin Solar mái nhà", "Tư vấn báo giá trực tuyến").
  - *Thời lượng:* (Ví dụ: 15 phút, 30 phút, 60 phút).
  - *Hình thức gặp (Location Type):* `GOOGLE_MEET` (tự động sinh link họp trực tuyến), `PHONE` (gọi điện thoại), hoặc `ONSITE` (gặp trực tiếp tại nhà khách hàng).
  - *Mô tả:* Nội dung tóm tắt để khách hàng chuẩn bị trước.
- **Liên kết chỉ định (Query Parameter Routing)**: Để giữ tính linh hoạt, nhân viên Sales có thể chia sẻ link đặt lịch cá nhân cho khách hàng bằng cách thêm tham số truy vấn định danh của họ (Ví dụ: `?host_id=sales-uuid`). Khi truy cập, hệ thống sẽ bỏ qua cơ chế xoay vòng Round-Robin và chỉ tính toán lịch rảnh của chính Sales Rep đó.

### 2.3. Thuật toán Sinh khung giờ trống (Available Slots Generator)
- Khi khách hàng truy cập trang đặt lịch hoặc khi AI Chatbot gợi ý khung giờ, hệ thống phải tự động tính toán và trả về các khung giờ trống của Sales:
  - Lấy lịch làm việc rảnh trong tuần của Sales.
  - Loại trừ các khoảng thời gian đã trùng với các cuộc hẹn có trạng thái `CONFIRMED` hoặc `PENDING` của Sales đó trong CSDL.
  - **Màng lọc thụ động Google Calendar**: Đọc trạng thái bận (Busy status) từ Google Calendar liên kết của Sales để ẩn các slot tương ứng (không ghi đè hay thay đổi lịch trên Google Calendar), giúp Sales chỉ cần quản lý một lịch làm việc duy nhất trên Google Workspace.
  - Giới hạn thời gian chuẩn bị (Buffer Time): Đảm bảo các cuộc hẹn phải cách nhau tối thiểu 15 phút để Sales nghỉ ngơi và chuẩn bị.
  - Ngăn chặn đặt lịch cận giờ (Min Booking Notice): Khách hàng chỉ được phép đặt lịch trước tối thiểu 2 giờ diễn ra cuộc hẹn để tránh tình trạng Sales không kịp chuẩn bị.

### 2.4. Đồng bộ hóa CRM & Tự động gán quyền (CRM Integration)
- Khi khách đặt lịch thành công:
  - Hệ thống kiểm tra số điện thoại/email trong CSDL CRM. Nếu chưa có khách hàng tương ứng -> tự động tạo hồ sơ khách hàng mới (`crm_customers`) ở trạng thái `NEW`.
  - Tự động gán Sales rep tổ chức cuộc hẹn làm người phụ trách hồ sơ khách hàng đó (`assignee_id = host_id`).
  - Ghi nhận một sự kiện hoạt động mới có loại `APPOINTMENT_SCHEDULED` vào timeline hoạt động (`crm_activities`).

### 2.5. Phát Sự Kiện Thông Báo Cuộc Hẹn (Event-Driven Notification)

> **Nguyên tắc kiến trúc:** Booking Module **không tự gửi** Email hay Zalo trực tiếp. Thay vào đó, Module phát sự kiện (emit event) qua Event Bus nội bộ và Module Notification sẽ đảm nhận toàn bộ việc phân phối thông báo theo đúng kênh và đúng người nhận.

- **Khi cuộc hẹn được xác nhận** (`CONFIRMED`), hệ thống emit 3 events:
  1. `appointment.confirmed` — Kích hoạt gửi xác nhận ngay lập tức cho Sales và Khách hàng.
  2. `appointment.reminder_24h` — Notification Module lên lịch job delayed 24h trước cuộc hẹn.
  3. `appointment.reminder_1h` — Notification Module lên lịch job delayed 1h trước cuộc hẹn (kèm link Google Meet nếu là hình thức `GOOGLE_MEET`).
- **Khi cuộc hẹn bị hủy** (`CANCELLED`) hoặc đổi lịch (`RESCHEDULED`), hệ thống emit `appointment.cancelled`. Notification Module chịu trách nhiệm tự động hủy các reminder jobs đang chờ và gửi thông báo hủy.
- **Payload event** phải bao gồm đầy đủ: `appointmentId`, `startTime`, `endTime`, `locationType`, `meetLink` (nếu có), thông tin Sales và Khách hàng (tên, email, `zalo_user_id`) để Notification Module không cần truy vấn DB ngoài module.

### 2.6. Chatbot AI đặt lịch trực tiếp (AI Integration Tool)
- Chatbot AI (ReAct Agent) phải được trang bị các tools đặt lịch:
  - `get_available_slots`: Cho phép AI tra cứu các khung giờ trống của Sales để gợi ý trực tiếp cho khách qua chat.
  - `create_appointment`: Cho phép AI thay mặt khách hàng đăng ký cuộc hẹn ngay khi khách chốt được khung giờ.

---

## 3. Chỉ Số Hiệu Năng & Trải Nghiệm (KPIs)
- **Tính toán Slots trống:** Thuật toán lọc giờ trống phải chạy xong dưới **< 100ms** để đảm bảo tốc độ phản hồi của AI Chatbot.
- **Tính chính xác:** Tránh 100% việc trùng lịch (Double-Booking) cho cùng một Sales trong cùng một khung giờ.
