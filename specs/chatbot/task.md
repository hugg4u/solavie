# Task Lập Trình Module Chatbot & AI Core

Kế hoạch phát triển module Chatbot & AI Core được phân chia thành 5 Phase triển khai tuần tự theo thực tiễn tốt nhất (Best Practice):

## Phase 1: Setup Infrastructure & Base LLM Engine
- [ ] **Database Setup:** Thiết lập các bảng `gw_llm_providers`, `gw_llm_provider_models`, `gw_llm_usecases`, `gw_llm_metrics` và các cột theo dõi nhắc nhở (`last_message_at`, `last_customer_message_at`, `followup_status`) trong bảng `chat_conversations`.
- [ ] **LLM Gateway (LiteLLM):** Thiết lập docker-compose để chạy service LiteLLM proxy ở chế độ pass-through.
- [ ] **LLM Base Adapter:** Khai báo Interface `BaseLLMAdapter` trong NestJS.
- [ ] **OpenAI Compatible Client:** Triển khai class adapter kết nối tới LiteLLM sử dụng OpenAI SDK, hỗ trợ nạp động API Key từ Header.
- [ ] **Lazy Load Registry:** Triển khai class Registry/Factory để load động và cache instances adapter.
- [ ] **Dynamic Router & Failover Interceptor:** Triển khai logic NestJS Interceptor/Service để tự động định tuyến theo priority và bắt lỗi cạn tiền (`insufficient_quota`) để chuyển đổi trạng thái `OUT_OF_CREDIT` và failover.
- [ ] **Async Metrics Logger:** Triển khai Event Listener `@OnEvent('llm.metrics.created')` để thực hiện tính toán chi phí (áp dụng cached token discount) và chèn dữ liệu thô vào bảng `gw_llm_metrics` chạy ngầm.

## Phase 2: RAG Pipeline Implementation (Hierarchical & Hybrid)
- [ ] **Vector DB Integration:** Tích hợp thư viện TypeORM/Prisma hỗ trợ kiểu dữ liệu `vector` trên PgVector.
- [ ] **Hierarchical Chunking Script:** Viết Node.js script đọc tài liệu Solar (PDF/Markdown), thực hiện chia thành Parent Chunks (1000 tokens) và Child Chunks (200 tokens, overlap 50 tokens), sau đó lưu vào bảng `rag_documents`.
- [ ] **PostgreSQL FTS Optimization:** Thiết lập cột sinh (generated column) `tsv_content` trên bảng `rag_documents`, tạo index GIN và viết lại hàm tìm kiếm lai sử dụng cột này để tăng tốc tìm kiếm.
- [ ] **Query Rewriter & Classifier Service:** Code logic gọi LLM phụ (`gpt-4o-mini` hoặc `gemini-1.5-flash`) ở chế độ JSON Mode để đồng thời viết lại câu hỏi và phân loại domain (`is_in_domain`).
- [ ] **Chatbot OOD Filter Service:** Triển khai `ChatbotOodFilterService` kết hợp bộ lọc Regex tĩnh (General Greeting Filter) và gọi Classifier động để chặn tin nhắn lạc đề trước khi đi vào RAG/Agent, tự động gửi phản hồi từ chối mẫu tĩnh.
- [ ] **Reranker Client Service:** Triển khai client kết nối tới Reranker API (Cohere / TEI) hỗ trợ sắp xếp lại tài liệu.
- [ ] **Hybrid Retrieval & RRF:** Viết hàm query Postgres thực hiện tìm kiếm lai (Vector Search + Full-Text Search tối ưu hóa trên `tsv_content`) và gộp thứ hạng theo thuật toán RRF ($k=60$). Lấy dữ liệu Parent Chunk tương ứng làm ngữ cảnh đầu ra.

## Phase 3: ReAct Agent & Tool Integration
- [ ] **ReAct Agent Loop:** Xây dựng core logic cho ReAct Agent (`Thought -> Action -> Observation`), giới hạn tối đa 3 iterations.
- [ ] **CRM Tool Integration:** Triển khai tool `crm_create_lead` gọi API sang CRM Module để tạo Lead.
- [ ] **RAG Tool Integration:** Triển khai tool `get_solar_knowledge` kết nối với RAG Pipeline.

## Phase 4: Guardrails & Optimization
- [ ] **PII Masking Guardrail:** Viết NestJS Interceptor quét và che giấu (Redact) SĐT, Email, Số thẻ của khách hàng ở đầu vào.
- [ ] **Output Guardrail (Filter & Price Check):** Triển khai interceptor quét đầu ra của LLM để lọc profanity, chặn rò rỉ mã lỗi hệ thống, và so khớp giá Solar trích xuất được với bảng giá tham chiếu để chống sai giá.
- [ ] **Hallucination Grounding Validator:** Xây dựng module gọi LLM phụ chấm điểm tính trung thực (Faithfulness) của câu trả lời AI so với RAG context để chặn đứng ảo giác trước khi gửi đi.
- [ ] **BullMQ & Redis Dynamic Debounce:** Thiết lập hàng đợi BullMQ `chatbot-debounce` và Redis List buffer để xử lý gộp tin nhắn của khách trong 10 giây tĩnh lặng, loại bỏ double-texting.
- [ ] **Token Flood Protection:** Tích hợp logic giới hạn 5 tin nhắn và cắt chuỗi gộp ở 2,000 ký tự trong debounce controller/consumer để chống spam.
- [ ] **BullMQ Follow-up Scheduler:** Thiết lập hàng đợi BullMQ `chatbot-followup` để tự động nhắc nhở khách hàng sau 2 giờ im lặng (gọi LLM sinh tin nhắn động nếu ở chế độ `AUTOMATIC` hoặc alert Sales nếu ở chế độ `MANUAL`).
- [ ] **Quiet Hours Guard:** Viết logic hoãn gửi nhắc nhở trong khung giờ [22h00 - 07h00] sáng và tự động reschedule sang 08h00 sáng hôm sau.
- [ ] **Gateway Circuit Breaker (Cooldown):** Triển khai logic đếm lỗi trên Redis (errors count) và cách ly 15 phút (cooldown key) đối với các Provider lỗi liên tiếp 3 lần.
- [ ] **Multi-Provider Prompt Caching Adaptation:** Hiện thực hóa logic chèn cờ cache động trong Adapter tương ứng với Anthropic (header, `cache_control` block) và Gemini (cachedContents API) để giảm chi phí đầu vào.
- [ ] **System Prompt Optimization:** Cấu trúc lại System Prompt để tối ưu hóa tính năng Prompt Caching (đảm bảo phần tĩnh đứng đầu và vượt ngưỡng 1024 tokens).

## Phase 5: Centralized Logging, Sync Job & Monitoring
- [ ] **Structured Logging:** Cấu hình Winston Logger để ghi log dạng JSON ra stdout phục vụ Promtail scrape.
- [ ] **Metrics Tracker:** Ghi nhận token usage, cost, latency và matching score của RAG vào log metadata.
- [ ] **Models Sync Job:** Triển khai Cron Job hàng ngày kết nối tới LiteLLM `/public/litellm_model_cost_map` để tự động upsert thông số model (max_tokens, costs, raw_metadata) và phân loại tier.
- [ ] **Manual Sync Endpoint:** Triển khai API `/api/v1/gateway/models/sync` cho phép Admin kích hoạt đồng bộ model bằng tay.
- [ ] **Admin Cost Analytics API:** Triển khai các API endpoints `/api/v1/gateway/metrics/summary` và `/metrics/raw` phục vụ vẽ biểu đồ báo cáo tài chính AI.



