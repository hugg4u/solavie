# Yêu Cầu Chức Năng Module Chatbot & AI Core (Requirements)

## 1. Giới thiệu Module
Module Chatbot chịu trách nhiệm tiếp nhận tin nhắn từ người dùng, duy trì ngữ cảnh hội thoại, tích hợp Engine AI (LLM) để sinh câu trả lời tự nhiên, và gọi vào hệ thống RAG để truy xuất kiến thức chuyên môn về Năng lượng mặt trời.

## 2. Yêu cầu nghiệp vụ & Kỹ thuật tối ưu (Phase 1)

### 2.1. Hỗ trợ Đa Mô Hình (Multi-LLM Support & Gateway)
- **Kiến trúc LLM Gateway:** Sử dụng LiteLLM làm Router trung gian chạy độc lập để quản lý và định tuyến linh hoạt tới các nhà cung cấp AI (OpenAI, Gemini, Anthropic).
- **Cơ chế Failover & SLA:** Tự động chuyển đổi sang Model dự phòng trong vòng **<= 500ms** nếu Model chính trả về mã lỗi `HTTP 429` (Rate Limit) hoặc `HTTP 5xx`.
- **Hỗ trợ Adapter nội bộ:** Trong Core Backend, áp dụng Adapter Pattern để đồng nhất hóa dữ liệu đầu ra từ các API khác nhau về dạng chuẩn của Solavie.

### 2.2. Xử lý Ngữ cảnh & Tối ưu hóa (Context & Caching)
- **Trượt Ngữ Cảnh (Sliding Window):** Giới hạn lịch sử hội thoại gửi lên LLM tối đa **10 lượt chat gần nhất** để kiểm soát chi phí token và tránh quá tải Context Window.
- **Prompt Caching:** Bắt buộc áp dụng cơ chế Ephemeral Caching (như của Anthropic/OpenAI) cho System Prompt tĩnh.
  - *KPI:* Giảm ít nhất **80% chi phí token đầu vào** cho mỗi lượt hội thoại tiếp theo trong cùng một phiên chat.
  - *Hiệu năng:* Độ trễ xử lý System Prompt được cache phải giảm từ **~3s xuống <= 500ms**.

### 2.3. Trích xuất Thực thể (Entity Extraction - NER)
- Trong lúc trò chuyện, AI phải sử dụng cấu trúc **JSON Mode** hoặc **Function Calling** để tự động bóc tách các thông tin: Họ tên, Số điện thoại, Tiền điện hàng tháng, Diện tích mái, Khu vực lắp đặt.
- **Tích hợp CRM:** Bắn Event bất đồng bộ `chat.entity.extracted` sang module CRM để tự động cập nhật hoặc tạo mới hồ sơ Lead mà không làm ảnh hưởng đến thời gian phản hồi của Chatbot.

### 2.4. RAG (Retrieval-Augmented Generation) & Tìm kiếm Lai
- **Hierarchical Chunking (RAG phân cấp):** Hỗ trợ chia nhỏ văn bản kỹ thuật Solar thành Child Chunks (~200 tokens) để định chỉ mục và tìm kiếm chính xác, nhưng lấy Parent Chunks (~1000 tokens) làm ngữ cảnh để cung cấp đầy đủ thông tin cho LLM.
- **Hybrid Search + RRF:** Kết hợp Full-Text Search (Sparse) trên nội dung văn bản và Vector Search (Dense) trên PgVector. Sử dụng thuật toán RRF để xếp hạng lại tài liệu.
  - *Độ chính xác:* Đảm bảo top 3 tài liệu trả về chứa thông tin kỹ thuật chính xác cho câu hỏi của khách hàng.

### 2.5. Hand-off (Bàn giao cho người thật)
- Tự động nhận diện ý định (Intent Routing) của khách hàng: Nếu phát hiện từ khóa giận dữ, khiếu nại (`COMPLAINT`) hoặc yêu cầu trực tiếp gặp tư vấn viên (`HUMAN_REQUEST`).
- **Chuyển đổi trạng thái:** Dừng ngay phản hồi AI, cập nhật trạng thái phiên chat sang `MANUAL`, gửi thông báo chào đón của Agent và bắn Noti Push (qua Event Broker) cho chuyên viên Sales.

### 2.6. Guardrails (Rào Chắn Bảo Mật & PII)
- **Input Guardrails (Data Masking):** Bắt buộc ẩn danh (quét bằng Regex) các thông tin nhạy cảm của khách hàng (Số điện thoại, Email, Số thẻ tín dụng) thành `[PHONE_REDACTED]`, `[EMAIL_REDACTED]` trước khi gửi dữ liệu ra ngoài API của các nhà cung cấp LLM.
- **Output Guardrails (Chống ảo giác & Nội dung cấm):** Quét câu trả lời của LLM để đảm bảo không chứa mã lỗi kỹ thuật hệ thống, từ ngữ thô tục, hoặc thông tin sai lệch về bảng giá chính thức của Solavie.

### 2.7. Bộ lọc Ngoài Phạm Vi (Out-Of-Domain Filter)
- **Lọc xã giao tĩnh (General Greeting Filter):** Sử dụng Regex tĩnh tại backend để quét và nhận diện các câu chào hỏi, xưng hô hoặc đề xuất gặp người tư vấn thông thường (ví dụ: "alo", "chào bạn", "hello shop"). Cho phép bypass hoàn toàn bộ Classifier LLM để đi thẳng tới ReAct Agent nhằm giảm độ trễ và chi phí.
- **Lọc động tích hợp (Query Classifier):** Tích hợp chức năng phân loại vào chung dịch vụ Query Rewriter (chạy ở JSON Mode) để đồng thời kiểm tra tính hợp lệ của câu hỏi (`is_in_domain`) thông qua prompt tối ưu hóa của LLM.
- **Ngắt luồng & Phản hồi mẫu tĩnh:** Khi `is_in_domain = false`, hệ thống lập tức chấm dứt pipeline (không chạy RAG, không chạy ReAct Agent) và phản hồi tin nhắn mẫu từ chối lịch sự được cấu hình sẵn.
- *KPI:* Chặn đứng 99% các câu hỏi thuộc chủ đề ngoài phạm vi năng lượng mặt trời (như viết code, làm toán, giải trí...), đồng thời tiết kiệm 100% chi phí token phân loại đối với các lời chào xã giao tĩnh.

## 3. Chỉ Số Hiệu Năng Chính (KPIs)
- **Độ trễ phản hồi đầu tiên (Time to First Token - TTFT):** Phải đạt **<= 1.5s** thông qua cơ chế Streaming SSE (Server-Sent Events).
- **Tỷ lệ uptime của Chatbot:** Đạt tối thiểu **99.9%** nhờ cơ chế Failover đa nhà cung cấp trên LLM Gateway.

