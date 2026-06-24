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
- **Prompt Caching:** Bắt buộc áp dụng cơ chế Prompt Caching thích ứng động (được cấu trúc hóa theo 4 nhóm cơ chế xử lý cho 17 providers bao gồm OpenAI, Anthropic, Gemini, DeepSeek, Bedrock, Vertex AI, v.v.).
  - *KPI:* Giảm ít nhất **80% chi phí token đầu vào** cho mỗi lượt hội thoại tiếp theo trong cùng một phiên chat khi sử dụng các provider hỗ trợ cache.
  - *Hiệu năng:* Độ trễ xử lý System Prompt được cache phải giảm từ **~3s xuống <= 500ms**.

### 2.3. Trích xuất Thực thể (Entity Extraction - NER)
- Trong lúc trò chuyện, AI phải sử dụng cấu trúc **JSON Mode** hoặc **Function Calling** để tự động bóc tách các thông tin: Họ tên, Số điện thoại, Tiền điện hàng tháng, Diện tích mái, Khu vực lắp đặt.
- **Tích hợp CRM:** Bắn Event bất đồng bộ `chat.entity.extracted` sang module CRM để tự động cập nhật hoặc tạo mới hồ sơ Lead mà không làm ảnh hưởng đến thời gian phản hồi của Chatbot.

### 2.4. RAG (Retrieval-Augmented Generation) & Tìm kiếm Lai
- **Hierarchical Chunking (RAG phân cấp):** Hỗ trợ chia nhỏ văn bản kỹ thuật Solar thành Child Chunks (~200 tokens) để định chỉ mục và tìm kiếm chính xác, nhưng lấy Parent Chunks (~1000 tokens) làm ngữ cảnh để cung cấp đầy đủ thông tin cho LLM.
- **Hybrid Search + RRF:** Kết hợp Full-Text Search (Sparse) trên nội dung văn bản và Vector Search (Dense) trên PgVector. Sử dụng thuật toán RRF để xếp hạng lại tài liệu.
  - *Độ chính xác:* Đảm bảo top 3 tài liệu trả về chứa thông tin kỹ thuật chính xác cho câu hỏi của khách hàng.

### 2.5. Hand-off (Bàn giao cho người thật) & Trả Quyền AI (Handback)
- **Tự động nhận diện ý định:** Tự động chuyển giao khi phát hiện khách hàng muốn gặp tư vấn viên (`HUMAN_REQUEST`) hoặc AI không tìm được câu trả lời phù hợp trong Knowledge Base (sau 2 lần fallback).
- **Gửi tin nhắn phản hồi chuyển giao:** Tại thời điểm chuyển giao, hệ thống **bắt buộc phải gửi ngay lập tức** một tin nhắn tự động lịch sự thông báo cho khách hàng (ví dụ: *"Yêu cầu tư vấn của anh/chị đã được chuyển đến kỹ sư hỗ trợ và sẽ phản hồi sớm nhất..."*), đảm bảo khách hàng không phải chờ đợi trong im lặng.
- **Chuyển đổi trạng thái & Alert:** Dừng ngay phản hồi AI, cập nhật trạng thái phiên chat sang `MANUAL`, và phát sự kiện `chat.handover_requested` qua Event Bus nội bộ. Sự kiện này được Notification Module lắng nghe và chịu trách nhiệm gửi thông báo thời gian thực (In-App WebSocket) cho chuyên viên Sales được gán theo cơ chế Round-Robin.
- **API Trả Quyền AI (Handback API):** Cung cấp cơ chế cho phép chuyên viên Sales gọi API bàn giao lại cuộc trò chuyện từ `MANUAL` về `AUTOMATIC` để kích hoạt lại AI Chatbot tự động trả lời khi nhân viên hoàn thành tư vấn.


### 2.6. Guardrails (Rào Chắn Bảo Mật & PII)
- **Input Guardrails (Data Masking):** Bắt buộc ẩn danh (quét bằng Regex) các thông tin nhạy cảm của khách hàng (Số điện thoại, Email, Số thẻ tín dụng) thành `[PHONE_REDACTED]`, `[EMAIL_REDACTED]` trước khi gửi dữ liệu ra ngoài API của các nhà cung cấp LLM.
- **Output Guardrails (Chống ảo giác & Nội dung cấm):** Quét câu trả lời của LLM để đảm bảo không chứa mã lỗi kỹ thuật hệ thống, từ ngữ thô tục, hoặc thông tin sai lệch về bảng giá chính thức của Solavie.

### 2.7. Bộ lọc Ngoài Phạm Vi (Out-Of-Domain Filter)
- **Lọc xã giao tĩnh (General Greeting Filter):** Sử dụng Regex tĩnh tại backend để quét và nhận diện các câu chào hỏi, xưng hô hoặc đề xuất gặp người tư vấn thông thường (ví dụ: "alo", "chào bạn", "hello shop"). Cho phép bypass hoàn toàn bộ Classifier LLM để đi thẳng tới ReAct Agent nhằm giảm độ trễ và chi phí.
- **Lọc động tích hợp (Query Classifier):** Tích hợp chức năng phân loại vào chung dịch vụ Query Rewriter (chạy ở JSON Mode) để đồng thời kiểm tra tính hợp lệ của câu hỏi (`is_in_domain`) thông qua prompt tối ưu hóa của LLM.
- **Ngắt luồng & Phản hồi mẫu tĩnh:** Khi `is_in_domain = false`, hệ thống lập tức chấm dứt pipeline (không chạy RAG, không chạy ReAct Agent) và phản hồi tin nhắn mẫu từ chối lịch sự được cấu hình sẵn.
- *KPI:* Chặn đứng 99% các câu hỏi thuộc chủ đề ngoài phạm vi năng lượng mặt trời (như viết code, làm toán, giải trí...), đồng thời tiết kiệm 100% chi phí token phân loại đối với các lời chào xã giao tĩnh.

### 2.8. Tối ưu hóa hàng đợi (Debounce & Follow-up Queue Tuning)
- **Tách biệt kết nối Redis:** Các queue BullMQ của chatbot (`chatbot-debounce` và `chatbot-followup`) phải kết nối tới instance Redis chạy chính sách `noeviction` để bảo vệ dữ liệu hàng đợi không bị xóa khi bộ nhớ đầy.
- **Tối ưu hóa TCP Connection:** Sử dụng cơ chế kết nối dùng chung (Shared connection instance) của `ioredis` để giảm thiểu overhead mở/đóng kết nối liên tục.
- **Tự động dọn dẹp bộ nhớ:** Các job trong hàng đợi sau khi hoàn thành hoặc thất bại vượt quá giới hạn phải được tự động xóa (`removeOnComplete`, `removeOnFail`) nhằm giải phóng RAM cho Redis.

## 3. Chỉ Số Hiệu Năng Chính (KPIs)
- **Độ trễ phản hồi đầu tiên (Time to First Token - TTFT):** Phải đạt **<= 1.5s** thông qua cơ chế Streaming SSE (Server-Sent Events).
- **Tỷ lệ uptime của Chatbot:** Đạt tối thiểu **99.9%** nhờ cơ chế Failover đa nhà cung cấp trên LLM Gateway.

### 2.9. Tự động Nhận diện và Phản hồi Đa Ngôn Ngữ Động (Dynamic Multilingual Response)
- **Nhận diện tự động:** Hệ thống tự động nhận diện ngôn ngữ của khách hàng (tiếng Việt, tiếng Anh, tiếng Trung...) mà không làm tăng độ trễ (latency < 1ms, chạy offline trên server).
- **i18n Fallback tĩnh:** Các tin nhắn tĩnh của hệ thống (lỗi kết nối, thông báo chuyển giao nhân viên...) phải được bản địa hóa qua cấu trúc file JSON nội bộ (`vi.json`, `en.json`, `zh.json`), không gọi LLM để tiết kiệm 100% chi phí token.
- **Dynamic translation:** Đối với hội thoại AI, LLM tự động dịch tài liệu RAG tiếng Việt sang ngôn ngữ của khách hàng ở đầu ra thông qua chỉ thị ngắn chèn ở cuối prompt, giữ nguyên Prompt Caching của System Prompt tĩnh.

### 2.10. Kiểm thử tự động chất lượng Prompt (Evals Engine)
- **Golden Dataset:** Hỗ trợ lưu trữ bộ câu hỏi và câu trả lời mẫu chuẩn (ground-truth) để chạy thử nghiệm prompt offline.
- **LLM-as-a-Judge:** Sử dụng mô hình lớn (được định tuyến qua Gateway kịch bản `EVALS_JUDGE`) để chấm điểm Grounding (độ trung thực, chống ảo giác) và Relevance (độ liên quan câu hỏi) trên thang điểm 1-5, đảm bảo prompt cập nhật không làm suy giảm chất lượng trả lời.

### 2.11. Tích hợp Công cụ AI Đặt Lịch Hẹn (AI Booking Tools)
- **Hỗ trợ ReAct Agent Tools**: AI Chatbot trong cuộc đối thoại phải có khả năng tự động gọi 2 công cụ khi phát hiện ý định đặt lịch của khách hàng:
  - `get_booking_slots`: Tra cứu lịch trống của các Sales Rep dựa trên loại cuộc hẹn mẫu.
  - `create_appointment`: Tạo lịch hẹn chính thức trên hệ thống.
- **Quy tắc trích xuất thực thể**: Chatbot chỉ được phép gọi công cụ tạo lịch sau khi đã thu thập và xác nhận đầy đủ các thông tin bắt buộc từ khách hàng (Họ tên, SĐT, Email, Khung giờ bắt đầu).
- **Rào cản kiểm thực dữ liệu (Validation Gate)**: Chatbot cần tự động kiểm tra định dạng số điện thoại Việt Nam trước khi gửi lệnh tạo lịch nhằm giảm thiểu lỗi DB transaction.
- **Chỉ định Sales Rep**: Khi khách đặt lịch qua link có chứa tham số chỉ định Sales Rep (`?host_id=`), chatbot phải truyền tham số này vào công cụ để khóa lịch rảnh đối với Sales đó.

### 2.12. Trình Tạo Luồng Tự Do & Từ Khóa Kích Hoạt (Flows & Keywords)

Để giảm tải cho AI Agent và tăng khả năng thiết lập kịch bản marketing dẫn dắt khách hàng:
-   **Form-based Flow Composer UI (Phase 1):**
    -   Cho phép Admin cấu hình kịch bản flows mà không cần visual drag-and-drop builder phức tạp ở Phase 1. Thiết kế sử dụng giao diện điền Form: Cột trái hiển thị danh sách các Node có trong kịch bản; Cột giữa hiển thị biểu mẫu cấu hình chi tiết cho Node đang chọn.
    -   Hỗ trợ 4 loại Node cốt lõi:
        -   `MESSAGE`: Gửi tin nhắn văn bản kèm tối đa 3 nút bấm (Buttons) hoặc Carousel Group (Thẻ trượt chứa ảnh + tiêu đề + mô tả + nút).
        -   `ACTION`: Tự động gắn tag CRM cho khách hàng, phân công Sales Rep, hoặc gửi dữ liệu qua API ngoài.
        -   `CONDITION`: Rẽ nhánh luồng dựa trên thuộc tính của khách hàng (VD: Địa phương = "Đồng Nai" rẽ nhánh A, ngược lại rẽ nhánh B).
    -   **Graph Validation Gate:** Backend bắt buộc phải xác thực tính toàn vẹn của đồ thị (DFS phát hiện chu trình vòng lặp, BFS phát hiện node cô lập) trước khi lưu.
-   **Từ Khóa Kích Hoạt (Keywords Matcher):**
    -   So khớp tin nhắn khách hàng với danh sách từ khóa tĩnh được định nghĩa trước.
    -   Hỗ trợ 3 kiểu khớp: Khớp chính xác (`EXACT`), Chứa từ khóa (`CONTAINS`), Bắt đầu bằng từ khóa (`STARTS_WITH`).
    -   Khi khớp, hệ thống tự động đổi `bot_state` của hội thoại thành `FLOW_EXECUTING` và gửi node đầu tiên của Flow được gán.

### 2.13. Chuỗi Chăm Sóc (Sequences) & Gửi Tin Hàng Loạt (Broadcasting)

-   **Chuỗi chăm sóc tự động (Sequences):**
    -   Gửi tin nhắn bám đuổi khách hàng theo kịch bản thời gian trì hoãn (Delay Timeline, ví dụ: Sau khi đăng ký 1 ngày gửi tin A, sau 3 ngày gửi tin B).
    -   Sử dụng hàng đợi delay của BullMQ (`solavie:chatbot-sequence`) để lên lịch chạy ngầm.
    -   Tự động dừng gửi chuỗi (Unsubscribe) ngay khi khách hàng có phản hồi chat tay hoặc Sales Rep chủ động tiếp quản (`bot_state = MANUAL`).
-   **Công cụ tăng trưởng (Growth Tools):**
    -   Cho phép sinh link tiếp thị (`https://solavie.vn/ref/fb_ads_june`) hoặc mã QR Code chứa tham số `ref_parameter`.
    -   Khi khách quét mã/click link dẫn vào inbox Messenger/Zalo OA, Gateway bóc tách tham số và kích hoạt kịch bản Flow tương ứng.
-   **Gửi tin hàng loạt (Broadcasting Engine):**
    -   Lên chiến dịch gửi tin nhắn chủ động hàng loạt tới tệp khách hàng được lọc động từ CRM theo các điều kiện (địa phương, giai đoạn lead, mức độ tiềm năng).
    -   **Chạy bất đồng bộ:** Sử dụng BullMQ (`solavie:facebook-broadcast`, `solavie:zalo-broadcast`) để xử lý tác vụ ngầm.
    -   **Chia lô & Giãn cách (Rate Limiting):** Phân chia danh sách thành các lô 50 khách hàng. Áp dụng cơ chế nghỉ tự động (Facebook delay 1s, Zalo delay 0.5s giữa các tin) để chống spam và tránh bị block fanpage/OA.
    -   **Giờ giới nghiêm (Quiet Hours):** Tự động hoãn và dời lịch gửi sang 08:00 sáng hôm sau đối với các tin nhắn rơi vào khung giờ 22:00 - 07:00 nhằm tôn trọng khách hàng và tuân thủ chính sách Zalo.
    -   **Ngắt bảo vệ (Circuit Breaker):** Tự động tạm dừng chiến dịch và gửi cảnh báo email/In-app cho IT Admin thông qua Outbox Pattern nếu số tin gửi thất bại liên tiếp đạt ngưỡng 20 tin (do sập access token hoặc fanpage bị hạn chế).
    -   **Thống kê chi tiết:** Hiển thị biểu đồ thống kê thời gian thực về tỷ lệ gửi thành công, tỷ lệ thất bại, tỷ lệ click nút hành động trong tin nhắn của chiến dịch.


