# BUSINESS REQUIREMENT DOCUMENT (BRD)
## Hệ Thống Solavie Platform (Phase 1: Omnichannel Chat, AI & Solar CRM)

| Tài liệu | Business Requirement Document (BRD) |
| --- | --- |
| Dự án | Hệ thống AI Chatbot kết hợp CRM & O&M cho Năng lượng mặt trời Solavie |
| Phiên bản | 1.3.0 (Cấu trúc chi tiết sau Grill-Me) |
| Ngày cập nhật | 2026-06-15 |
| Trạng thái | Chờ duyệt |

---

## 1. Giới Thiệu Dự Án (Project Overview)
Solavie là doanh nghiệp cung cấp giải pháp và dịch vụ năng lượng mặt trời. Hệ thống **Solavie Platform (Phase 1)** hướng tới việc tự động hóa tối đa quy trình tiếp cận khách hàng tiềm năng (Leads) từ các kênh mạng xã hội, tư vấn kỹ thuật chuyên sâu bằng AI và quản lý dữ liệu tập trung qua hệ thống CRM đặc thù ngành Solar. 

---

## 2. Nghiệp Vụ CRM & Phạm Vi Phase 1
Để đảm bảo tiến độ triển khai nhanh và tập trung nguồn lực, phạm vi lưu trữ và quản lý của CRM trong Phase 1 được thu hẹp tối đa:
* **Thông tin Khách hàng (Lead/Customer)**: Chỉ lưu trữ thông tin cá nhân cơ bản (Họ tên, SĐT, Email, Địa chỉ) và các thông tin nhu cầu kỹ thuật cơ bản được trích xuất từ chat (Hóa đơn điện hàng tháng, diện tích mái khả dụng, nhu cầu lắp đặt).
* **Thông tin Dự án & Thiết bị (Solar Project & Assets)**: Sẽ **không lưu trữ** và quản lý trong Phase 1. Các module này cùng với quy trình Project Pipeline sẽ được tách ra phát triển ở các phase sau.

```
                  [Khách hàng liên hệ qua FB/Zalo]
                                │
                                ▼
         [AI RAG trả lời tự động & Trích xuất thông tin]
           - Hóa đơn điện hàng tháng
           - Diện tích mái khả dụng
           - Địa điểm lắp đặt
                                │
                                ▼
             [Tính toán ROI tự động sơ bộ trên CRM]
           - Đề xuất công suất lắp đặt (kWp)
           - Ước tính sản lượng & Số tiền tiết kiệm
           - Thời gian hoàn vốn (ROI)
                                │
                                ▼
         [Tạo Lead / Khách hàng trong CRM với Nhu cầu phân rã]
           - Chỉ lưu Thông tin cá nhân & Các trường Nhu cầu
```

### Các Tính Năng Nghiệp Vụ Trong Phase 1:
1. **Bộ Công Cụ Tính ROI Tự Động (Solar ROI Calculator)**: 
   - Đầu vào: Địa phương (tính số giờ nắng), diện tích mái (m2), số tiền điện hàng tháng.
   - Đầu ra: Công suất hệ thống đề xuất (kWp), số lượng tấm pin ước tính, sản lượng điện trung bình tháng (kWh), số tiền tiết kiệm hàng tháng, và thời gian hoàn vốn (năm).
2. **Quản Lý Lead & Customer**:
   - Lưu trữ thông tin cá nhân và nhu cầu đã phân rã thành các trường riêng biệt để phục vụ bộ lọc của CRM và thuật toán ROI.
3. **Cơ Chế Gộp Hồ Sơ Tối Ưu (Merge Profile)**:
   - Khi phát hiện trùng số điện thoại giữa các kênh chat khác nhau (ví dụ: cùng một số điện thoại được cung cấp từ Facebook Messenger và Zalo OA):
     - Xác định hồ sơ chính (Primary Profile - tạo trước hoặc đầy đủ hơn).
     - Ánh xạ các định danh mạng xã hội (`facebook_psid`, `zalo_user_id`) về hồ sơ chính.
     - Gộp lịch sử hội thoại (Conversations) về chung một dòng thời gian để nhân viên dễ dàng xem toàn bộ quá trình chat.
     - Đối với các trường nhu cầu bị xung đột dữ liệu: Ưu tiên giữ lại dữ liệu mới nhất, đồng thời ghi lại dữ liệu cũ vào nhật ký ghi chú (Notes/Activity Log) của khách hàng để tránh mất dữ liệu lịch sử.

---

## 3. Kiến Trúc Kỹ Thuật Tối Ưu

### 3.1. Phân Quyền Động (Dynamic Roles & Permissions)
Hệ thống áp dụng mô hình lai **RBAC + ABAC** (Role-Based & Attribute-Based Access Control) để phân quyền linh hoạt theo vai trò và thuộc tính dữ liệu.

* **Database Schema**:
  - `users`: Tài khoản người dùng hệ thống.
  - `roles`: Vai trò (Admin, Branch_Manager, Solar_Sales, Tech_Support).
  - `permissions`: Quyền hạn cụ thể (`lead:read`, `lead:create`, `lead:write`).
  - `policies` (ABAC Rules): Quy tắc thuộc tính (ví dụ: `sales_only` quy định Sales chỉ được sửa dữ liệu do mình phụ trách, `branch_only` quy định quản lý chi nhánh chỉ xem được dữ liệu của chi nhánh đó).
  - `role_permissions`: Bảng liên kết quyền và vai trò.
* **Tối ưu hóa**: Danh sách quyền hạn và quy tắc ABAC sau khi biên dịch được lưu vào **Redis Cache** (`user:permissions:${userId}`). Cache tự động bị xóa (invalidation) khi có bất kỳ thay đổi nào liên quan đến vai trò/phân quyền để đảm bảo cập nhật tức thì.
* **Nhật Ký Thay Đổi Quyền Chi Tiết (Audit Logging)**:
  - Bảng `role_audit_logs` sẽ lưu trữ chi tiết: *Người thực hiện (actor_id), Đối tượng bị tác động (target_user_id hoặc target_role_id), Loại hành động (CREATE/UPDATE/DELETE), Trạng thái cũ (old_state - dạng JSON) và Trạng thái mới (new_state - dạng JSON)*. Điều này giúp đảm bảo khả năng truy vết hoàn hảo.

---

### 3.2. Đa AI Provider Adapter & Kỹ Thuật Tối Ưu Hóa Hiệu Năng
Để đáp ứng yêu cầu hỗ trợ đa dạng provider (hơn 10 bên) nhưng vẫn đảm bảo **hiệu năng tối đa** và **tiết kiệm tài nguyên (CPU/RAM/Network)**, hệ thống áp dụng các kỹ thuật kiến trúc sau:

#### 1. Kiến Trúc Hợp Nhất Qua Giao Thức Tương Thích (OpenAI-Compatible Wrapper)
Thay vì cài đặt SDK riêng biệt của hơn 10 hãng (làm phình to kích thước bundle và tiêu tốn bộ nhớ RAM lúc khởi chạy ứng dụng), hệ thống chỉ sử dụng **2 thư viện SDK chính thức**:
* **`@google/generative-ai` (Gemini SDK)**: Tối ưu chuyên biệt cho Google Gemini (đáp ứng context lớn, multimodal).
* **`openai` (OpenAI SDK)**: Dùng chung cho OpenAI và tất cả các provider tương thích chuẩn API của OpenAI (như DeepSeek, Groq, Together AI, OpenRouter, SiliconFlow, Local LLM/vLLM/Ollama). Đối với các bên này, hệ thống chỉ cần truyền động cấu hình `baseURL` và `apiKey` từ Database vào OpenAI client tại runtime.

#### 2. Khởi Tạo Động & Trì Hoãn (Lazy Loading & Registry Pattern)
Các Adapter kết nối API sẽ không được khởi tạo sẵn khi ứng dụng khởi động (startup). Khi có yêu cầu xử lý chat từ một cuộc hội thoại cụ thể:
* Hệ thống đọc cấu hình Provider được gán cho kênh chat đó.
* **AI Model Factory** kiểm tra Registry trong bộ nhớ. Nếu adapter chưa được khởi tạo, nó mới tiến hành khởi tạo (Lazy Loading) và lưu lại (Cache Instance) để tái sử dụng. Kỹ thuật này giúp giảm lượng RAM tiêu thụ lúc startup về gần bằng 0 cho các module AI chưa dùng đến.

#### 3. Tái Sử Dụng Kết Nối Mạng (HTTP Connection Pooling & Keep-Alive)
Độ trễ của API LLM thường bị ảnh hưởng bởi quá trình bắt tay TCP/SSL (mất 200ms - 300ms cho mỗi request mới). Hệ thống cấu hình HTTP Client ở mức hệ thống sử dụng **Keep-Alive Agent**:
* Duy trì kết nối TCP mở với các endpoint của Gemini/OpenAI/OpenRouter.
* Tái sử dụng kết nối cũ cho các request tiếp theo, giúp giảm độ trễ phản hồi của AI Chatbot xuống mức thấp nhất.

#### 4. Stream Phản Hồi (Server-Sent Events - SSE)
* AI Chatbot trả kết quả về giao diện chat theo dạng Stream (từng từ một). Người dùng nhìn thấy phản hồi đầu tiên sau 200ms - 500ms, loại bỏ cảm giác chờ đợi mệt mỏi khi LLM xử lý các câu trả lời dài (thường mất 3s - 5s).

#### 5. Danh Sách Model Linh Hoạt (LiteLLM Integration)
* **LiteLLM Model List Sync**: Hệ thống định nghĩa một job chạy ngầm (Cron job) định kỳ đồng bộ danh sách Model từ cấu hình của LiteLLM lưu vào Database.
* Trên UI cấu hình CRM, Admin có thể lọc theo Provider và lựa chọn Model mong muốn từ danh sách tĩnh đã được đồng bộ để gán cho từng kịch bản chat mà không cần gọi API ngoài tại thời điểm render UI.

---

## 4. Các Yêu Cầu Chức Năng Chi Tiết (Phase 1)

### 4.1. Module Đa Kênh (Omnichannel Inbox)
* Tích hợp Facebook Fanpage, Messenger và Zalo OA.
* Đồng bộ tin nhắn tập trung về một giao diện chat.
* **Cơ chế Hybrid Chat & Fallback của Chatbot**:
  - Mặc định AI Chatbot sẽ tiếp quản cuộc hội thoại.
  - Khi khách hàng yêu cầu gặp tư vấn viên hoặc AI không tìm được câu trả lời phù hợp trong Knowledge Base (sau 2 lần fallback), AI sẽ tự động gắn tag "Human_Required", gửi thông báo (Notification) thời gian thực cho nhân viên và chuyển trạng thái sang "Manual".
  - Chatbot gửi một tin nhắn phản hồi lịch sự: *"Hiện tại các tư vấn viên kỹ thuật đang bận hoặc ngoài giờ làm việc. Chúng tôi đã chuyển yêu cầu của bạn đến kỹ sư hỗ trợ và sẽ phản hồi sớm nhất qua Zalo/SĐT này."*
  - Chatbot tạm dừng tự động trả lời cho đến khi nhân viên tiếp quản và trả quyền lại cho AI.

### 4.2. Module AI Chatbot & Knowledge Base (RAG)
* Quản lý Knowledge Base: Cho phép upload các tài liệu hướng dẫn kỹ thuật pin/inverter (Growatt, Huawei, Canadian Solar...).
* Hybrid Search RAG: Tìm kiếm kết hợp Vector Search và Keyword Search để tìm mã lỗi chính xác.
* Trích xuất thông tin: AI tự động nhận diện diện tích mái, hóa đơn tiền điện, vị trí lắp đặt của khách hàng qua hội thoại để tạo Lead trong CRM.
* **Bảo Mật & Tuân Thủ Dữ Liệu Khách Hàng (Guardrails)**: Áp dụng cơ chế Data Masking (ẩn danh bằng Regex) để che mờ tất cả Số điện thoại, Email, Thẻ tín dụng thành dạng `[REDACTED]` trước khi gửi dữ liệu hội thoại ra ngoài tới API của OpenAI/Google. Điều này bắt buộc để đảm bảo quyền riêng tư của khách hàng.
* **Bộ lọc câu hỏi ngoài phạm vi (Out-Of-Domain Filter)**: Thiết lập bộ lọc 2 lớp (Lọc Regex tĩnh cho các câu chào xã giao và Lọc LLM Classifier tích hợp trong Query Rewriter chạy ở JSON Mode) để ngăn chặn các câu hỏi lạc đề hoặc nỗ lực Jailbreak, tự động gửi phản hồi từ chối mẫu tĩnh và ngắt luồng xử lý RAG/Agent nhằm bảo vệ ngân sách chi phí AI.


### 4.3. Module CRM Quản Lý Khách Hàng & Nhu Cầu
* **Quản Lý Lead & Customer**: Lưu trữ thông tin cá nhân và nhu cầu lắp đặt (phân rã thành các trường dữ liệu riêng biệt).
* **Bộ tính toán ROI tự động**: Tích hợp công cụ tính sản lượng điện ước tính và ROI dựa trên địa phương (giờ nắng trung bình tại Việt Nam) và dữ liệu mái nhà.
* **Thông báo thời gian thực (Real-time Notification)**: Ngay khi AI thu thập đủ thông tin nhu cầu và tự tạo Lead trên CRM, hệ thống chỉ lưu thông tin Lead và kết quả ROI ước tính trong DB, đồng thời gửi thông báo tức thời cho nhân viên Sales qua Web Dashboard để họ chủ động gọi điện tư vấn trực tiếp (không tự động gửi báo giá thô qua chat).
* **Giao diện cấu hình AI**: Chọn Provider, Model (đồng bộ từ danh sách LiteLLM) và cấu hình Prompt cho chatbot.
