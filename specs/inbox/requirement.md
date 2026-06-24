# Yêu Cầu Chức Năng Module Agent Inbox (Requirements)

## 1. Giới thiệu Module
Module Agent Inbox (Sales Chat Portal) chịu trách nhiệm cung cấp giao diện tương tác, đàm thoại trực tiếp và chăm sóc khách hàng thủ công cho đội ngũ chuyên viên Sales. Module này tách biệt hoàn toàn với Chatbot AI để đảm bảo tính cô lập và quản lý luồng tương tác con người hiệu quả.

---

## 2. Yêu cầu nghiệp vụ & Kỹ thuật

### 2.1. Hộp thư tập trung đa kênh (Unified Inbox Feed)
- **Tập hợp hội thoại:** Hiển thị tất cả các cuộc trò chuyện từ các kênh Facebook, Zalo và Web Chat trên một giao diện Feed duy nhất.
- **Phân luồng trạng thái:** 
  - *Tab "Chưa giao":* Chứa các cuộc hội thoại ở trạng thái `MANUAL` nhưng chưa được gán cho nhân viên Sales nào.
  - *Tab "Của tôi":* Chứa các cuộc hội thoại ở trạng thái `MANUAL` và có `assignee_id` trùng với ID của Sales đang đăng nhập.
  - *Tab "AI đang chạy":* Chứa các cuộc hội thoại ở trạng thái `AUTOMATIC` (chỉ cho phép Sales đọc lịch sử chat thời gian thực dưới dạng Read-only, không được can thiệp gõ tin nhắn để tránh tranh chấp với AI).

### 2.2. Phân chia hội thoại thông minh (Smart Chat Assignment)
- **Nhận quyền thủ công (Manual Claim):** Sales có quyền xem danh sách ở Tab "Chưa giao" và ấn nút "Tiếp quản" để tự gán cuộc chat cho mình. Hệ thống cập nhật `assignee_id` và chuyển trạng thái cuộc chat sang `MANUAL`.
- **Phân chia tự động (Auto-routing - Round-Robin):** Khi một cuộc chat tự động chuyển sang `MANUAL` (do AI tự động handover khi gặp ca khó hoặc do khách hàng yêu cầu gặp người) mà chưa có ai nhận, hệ thống tự động gán cuộc trò chuyện cho Sales đang Online có lượt phục vụ kế tiếp theo cơ chế xoay vòng (Round-Robin).

### 2.3. Chống đụng độ phản hồi (Collision Detection)
- **Cảnh báo soạn thảo thời gian thực:** Để tránh tình trạng 2 Sales cùng lúc trả lời một khách hàng:
  - Khi Sales A click soạn tin nhắn nháp trên cuộc chat 123, toàn bộ các Portal của Sales khác đang xem cuộc chat này sẽ lập tức nhận được cảnh báo: *"Nhân viên A đang soạn câu trả lời..."*.
- **Vô hiệu hóa tạm thời:** Đồng thời, hệ thống sẽ tạm thời vô hiệu hóa (disable) khung chat và nút gửi của các nhân viên khác đối với cuộc chat đó.
- **Tự động mở khóa (Typing Idle Timeout):** Thiết lập thời gian tự động mở khóa là **5 giây** kể từ khi Sales A dừng gõ phím. Nếu sau 5 giây Sales A không phát sinh thao tác gõ mới và chưa gửi tin, hệ thống tự động giải phóng trạng thái lock để Sales khác có thể gõ phản hồi (đề phòng trường hợp Sales A bỏ quên tab hoặc đi ra ngoài).

### 2.4. Trao đổi và Thảo luận nội bộ (Internal Comments)
- **Tab Private Chat:** Cung cấp khu vực viết ghi chú nội bộ nằm song song với tab nhắn tin cho khách hàng. Tin nhắn viết tại đây chỉ hiển thị trên Portal cho các nhân viên xem và tuyệt đối không gửi webhook ra bên ngoài (khách hàng không thể thấy).
- **Tagging & Alert:** Hỗ trợ cú pháp `@tên_nhân_viên` để tag đồng nghiệp hỗ trợ (ví dụ: kỹ sư kỹ thuật Solar). Khi có @mention, hệ thống phát sự kiện `inbox.agent_mentioned` qua Event Bus nội bộ. Notification Module lắng nghe và chịu trách nhiệm gửi thông báo thời gian thực (In-App WebSocket) cho người được tag, đảm bảo họ nhận được cảnh báo tức thì trên màn hình Portal.

### 2.5. Mẫu câu trả lời nhanh (Quick Replies)
- **Soạn sẵn câu trả lời:** Hệ thống cho phép cấu hình các câu trả lời nhanh cho các câu hỏi phổ biến (ví dụ: bảng giá hệ pin 5kW, chính sách bảo hành pin).
- **Kích hoạt bằng phím tắt:** Sales có thể gõ ký tự `/` kèm shortcut (ví dụ: `/gia5kw`) để hệ thống gợi ý và tự động điền toàn bộ mẫu văn bản vào khung soạn thảo.

### 2.6. Cảnh báo và Chặn ngoài Cửa Sổ 24h (24h Policy Enforcement in Composer)
- **Cảnh báo badge:** Giao diện Portal bắt buộc phải hiển thị một nhãn trạng thái trực quan (Badge) thể hiện thời gian còn lại của cửa sổ 24 giờ kể từ tin nhắn cuối của khách hàng:
  - *Badge Xanh:* Còn trong 24 giờ (hiển thị thời gian đếm ngược, ví dụ: "Còn 15 giờ 20 phút").
  - *Badge Đỏ:* Đã ngoài 24 giờ (hiển thị "Ngoài cửa sổ 24h").
- **Chặn gõ tin nhắn tự do (Composer Lock):** Khi Badge chuyển sang Đỏ (ngoài 24h):
  - Khung soạn thảo tin nhắn tự do (Composer) bị vô hiệu hóa (disabled). Sales Rep không thể tự gõ văn bản tùy ý.
  - Hiển thị thông báo hướng dẫn: *"Đã hết thời gian phản hồi tự do 24h. Bạn chỉ có thể gửi mẫu tin nhắn mẫu (Template) được duyệt trước."*
  - Giao diện cung cấp nút chọn nhanh để Sales chọn các mẫu tin nhắn mẫu đính kèm tag phù hợp (như `CONFIRMED_EVENT_UPDATE` hoặc `HUMAN_AGENT`).

---

## 3. Chỉ Số Hiệu Năng & Trải Nghiệm (KPIs)
- **Độ trễ thông báo WebSocket:** Tin nhắn mới từ khách hàng hoặc sự kiện typing phải được đẩy lên màn hình Sales trong vòng **<= 200ms** thông qua kết nối WebSockets (Socket.io).
- **Độ tin cậy của Collision Lock:** Đảm bảo 100% không xảy ra đụng độ trùng lặp tin nhắn gửi đi từ 2 Sales khác nhau trên cùng một phiên chat.
