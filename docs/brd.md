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
  - `permissions`: Quyền hạn cụ thể (ví dụ: `crm.customer.read`, `crm.customer.write`).
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

### 4.1. Module Đa Kênh (Omnichannel Inbox & Gateway)
*   **Tích hợp đa nền tảng:** Kết nối Fanpage Facebook, Messenger và Zalo OA tập trung về một giao diện duy nhất thông qua Lớp trừu tượng Gateway.
*   **Zalo OA Token Sync Worker:** Tự động chạy ngầm làm mới (refresh) access token của Zalo OA mỗi 20 giờ để duy trì kết nối 24/7.
*   **Quản lý chính sách 24h:**
    *   Tự động theo dõi thời gian tương tác cuối cùng của khách.
    *   Chặn gửi tin quảng cáo ngoài 24h cho cả Facebook và Zalo.
    *   Tự động đính kèm Message Tags (`CONFIRMED_EVENT_UPDATE` cho đặt lịch và `HUMAN_AGENT` cho nhân viên chat tay) khi gửi tin ngoài cửa sổ tương tác.
*   **Tin giao dịch ZBS & ZNS:**
    *   Gửi tin giao dịch Zalo Business Services (ZBS) v3.0 dạng bảng thông số cấu trúc key-value.
    *   Gửi tin nhắn chăm sóc qua số điện thoại ZNS khi khách ngoài cửa sổ tương tác, tự động fallback sang Email AWS SES nếu số điện thoại không dùng Zalo.
*   **Cơ chế Hybrid Chat & Fallback của Chatbot**:
    *   Định tuyến tin nhắn thông minh dựa trên trạng thái hội thoại (`bot_state`: `AUTOMATIC` | `FLOW_EXECUTING` | `MANUAL`).
    *   Tự động tạm dừng kịch bản tĩnh và chuyển sang AI Agent khi khách gõ chữ tự do lạc đề.
    *   Tự động bàn giao cho nhân viên chat tay (`MANUAL`) khi phát hiện yêu cầu hỗ trợ hoặc sau 2 lần AI gặp lỗi ảo giác/không tìm thấy bối cảnh trong Knowledge Base.
    *   Gửi ngay tin nhắn phản hồi lịch sự thông báo chuyển giao: *"Yêu cầu tư vấn của anh/chị đã được chuyển đến kỹ sư hỗ trợ và sẽ phản hồi sớm nhất..."* để khách hàng không phải chờ đợi trong im lặng.
    *   Cung cấp API bàn giao lại cho AI (`Handback API`) bảo vệ bởi ABAC (chỉ assignee hoặc Admin/Manager được gọi).

### 4.2. Module AI Chatbot & Knowledge Base (RAG)
*   **Quản lý Knowledge Base:** Cho phép tải lên tài liệu kỹ thuật thiết bị solar (Growatt, Canadian Solar...), tự động chia nhỏ và index bằng cơ chế RAG phân cấp (Parent/Child Chunks).
*   **Tìm kiếm Lai RAG + RRF:** Kết hợp Vector Search (Dense) bằng PgVector HNSW Index và Full-Text Search (Sparse) tiếng Việt bằng GIN Index trên PostgreSQL, gộp thứ hạng bằng thuật toán RRF ($k=60$) để nâng cao độ chính xác.
*   **Trích xuất thực thể (NER):** Sử dụng LLM ở JSON Mode / Function Calling tự động bóc tách 4 thông số nhu cầu Solar (tiền điện, diện tích mái, địa điểm, công suất đề xuất) đồng bộ sang CRM.
*   **Bảo mật & Rào chắn (PII Guardrails):** Che giấu tự động thông tin nhạy cảm của khách hàng (SĐT, Email, Số thẻ) thành `[PHONE_REDACTED]`, `[EMAIL_REDACTED]` trước khi gửi lên API LLM. Quét đầu ra chống ảo giác giá và từ cấm thô tục.
*   **Bộ lọc ngoài phạm vi (OOD Filter):** Lọc Regex tĩnh cho lời chào xã giao (Bypass LLM) và bộ phân loại Classifier động (LLM JSON Mode) để từ chối các câu hỏi lạc đề, bảo vệ ngân sách chi phí token.

### 4.3. Module CRM Quản Lý Khách Hàng & Nhu Cầu
*   **Quản lý Lead & Customer:** Lưu trữ thông tin cá nhân và nhu cầu Solar phân rã thành các trường dữ liệu riêng biệt.
*   **Bộ tính toán ROI tự động:** Tự động tính toán sản lượng điện và thời gian hoàn vốn dựa trên số giờ nắng trung bình từng tỉnh thành Việt Nam.
*   **Cơ chế Gộp hồ sơ (Merge Profile):** Tự động gộp các phiên chat và thông tin nhu cầu khi phát hiện trùng số điện thoại giữa Facebook và Zalo, sử dụng khóa phân tán Redis để tránh race condition khi webhook gọi song song.
*   **Thông báo thời gian thực:** Đồng bộ sự kiện gán Lead và cập nhật lịch hẹn sang giao diện Dashboard của nhân viên Sales.

### 4.4. Module Tự Động Hóa & Gửi Tin Hàng Loạt (Automation & Broadcasting Engine)
*   **Luồng tin nhắn tự do (Flows & Nodes):** Cho phép Admin tự do tạo mới và sửa đổi kịch bản hội thoại từ đầu qua giao diện *Form-based Flow Composer UI*. Có thể thêm các khối tin nhắn văn bản, nhóm thẻ cuộn carousel, khối hành động (gắn tag CRM, phân công nhân viên) và cấu hình điều hướng node động bằng dropdown.
*   **Từ khóa kích hoạt (Keywords):** Cho phép cấu hình các từ khóa khớp chính xác, chứa từ khóa hoặc bắt đầu bằng từ khóa để tự kích hoạt Flow mà không tiêu hao chi phí AI.
*   **Chuỗi chăm sóc (Sequences):** Tự động gửi tin nhắn bám đuổi theo mốc thời gian trì hoãn (ngày/giờ) thiết lập trên Timeline, chạy qua hàng đợi trì hoãn BullMQ.
*   **Công cụ tăng trưởng (Growth Tools):** Sinh Ref URL và mã QR tương ứng dẫn trực tiếp khách hàng vào một Flow kịch bản xác định từ các kênh tiếp thị bên ngoài.
*   **Gửi tin hàng loạt (Broadcasting Engine):** Lên chiến dịch gửi tin hàng loạt đến tệp khách hàng lọc từ CRM. Sử dụng BullMQ để xử lý bất đồng bộ, chia lô (batching 50 khách) và tự động giãn cách (Facebook delay 1s, Zalo delay 0.5s) để chống spam.
    *   *Giờ giới nghiêm (Quiet Hours):* Tự động hoãn và dời lịch gửi sang 08:00 sáng hôm sau đối với các tin nhắn rơi vào khung giờ 22:00 - 07:00.
    *   *Ngắt bảo vệ (Circuit Breaker):* Tự động tạm dừng chiến dịch và gửi cảnh báo Admin khi số tin nhắn gửi thất bại liên tiếp đạt ngưỡng 20 tin (do sập token hoặc page bị khóa).
*   **Giao diện Quản trị và Thống kê:** Hiển thị biểu đồ báo cáo tỷ lệ gửi thành công, thất bại, tỷ lệ mở xem và click nút hành động của chiến dịch.

---

## 5. Các Tiêu Chuẩn Tối Ưu Hóa & Bảo Mật Kiến Trúc (Architectural Optimizations & Hardening)

Để đáp ứng tiêu chuẩn vận hành Enterprise ổn định và bảo mật cao, hệ thống áp dụng 5 giải pháp kiến trúc nâng cao:
1. **Transactional Outbox Pattern (Gateway):** Lưu tạm tin nhắn thô vào DB trước khi đẩy vào BullMQ để đảm bảo tin nhắn không bao giờ bị mất nếu hàng đợi/Redis bị sập.
2. **Distributed Redis Lock (CRM):** Khóa phân tán dựa trên số điện thoại khi thực hiện gộp trùng hồ sơ (Merge Profile) để triệt tiêu race condition từ webhook song song.
3. **Storage Garbage Collector (Storage):** Cron job quét dọn file rác (chưa confirm sau 24 giờ) để tối ưu bộ nhớ lưu trữ vật lý của MinIO.
4. **Mã hóa AES-256-GCM (Security):** Mã hóa đối xứng toàn bộ API Keys và Channel Access Tokens nhạy cảm dưới DB, bảo vệ an toàn thông tin hệ thống.
5. **IAM Cache Invalidation (IAM):** Tự động xóa Redis cache phân quyền của user ngay khi Admin thay đổi Role/Permission để quyền hạn mới có hiệu lực ngay lập tức.

