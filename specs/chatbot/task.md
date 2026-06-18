# Task Lập Trình Module Chatbot & AI Core

Kế hoạch phát triển module Chatbot & AI Core được phân chia thành 5 Phase triển khai tuần tự theo thực tiễn tốt nhất (Best Practice):

## Phase 1: Setup Infrastructure & Base LLM Engine
- [ ] **Database Setup:** Thiết lập các bảng `gw_llm_providers`, `gw_llm_provider_models`, `gw_llm_usecases`, `gw_llm_metrics`, bảng `chatbot_outbox_events` (cho Transactional Outbox) và các cột theo dõi nhắc nhở (`last_message_at`, `last_customer_message_at`, `followup_status`) trong bảng `chat_conversations`.
- [x] **LLM Gateway (LiteLLM):** Cấu hình container LiteLLM (Đã gộp vào [task.md (DevOps)](file:///d:/workspace/project/solavie/specs/devops/task.md)).
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
- [ ] **Booking Slots Lookup Tool:** Triển khai tool `get_booking_slots` gọi sang Booking Module (`AvailableSlotsService`) để lấy các slot trống của nhân viên Sales.
- [ ] **Booking Appointment Creation Tool:** Triển khai tool `create_appointment` gọi sang Booking Module (`AppointmentService`) để tự động tạo cuộc hẹn cho khách hàng khi chốt slot.

## Phase 4: Guardrails & Optimization
- [ ] **PII Masking Guardrail:** Viết NestJS Interceptor quét và che giấu (Redact) SĐT, Email, Số thẻ của khách hàng ở đầu vào.
- [ ] **Output Guardrail (Filter & Price Check):** Triển khai interceptor quét đầu ra của LLM để lọc profanity, chặn rò rỉ mã lỗi hệ thống, và so khớp giá Solar trích xuất được với bảng giá tham chiếu để chống sai giá.
- [ ] **Hallucination Grounding Validator:** Xây dựng module gọi LLM phụ chấm điểm tính trung thực (Faithfulness) của câu trả lời AI so với RAG context để chặn đứng ảo giác trước khi gửi đi.
- [ ] **BullMQ & Redis Dynamic Debounce:** Thiết lập hàng đợi BullMQ `chatbot-debounce` và Redis List buffer để xử lý gộp tin nhắn của khách trong 10 giây tĩnh lặng, loại bỏ double-texting.
- [ ] **Token Flood Protection:** Tích hợp logic giới hạn 5 tin nhắn và cắt chuỗi gộp ở 2,000 ký tự trong debounce controller/consumer để chống spam.
- [ ] **BullMQ Follow-up Scheduler:** Thiết lập hàng đợi BullMQ `chatbot-followup` để tự động nhắc nhở khách hàng sau 2 giờ im lặng (gọi LLM sinh tin nhắn động nếu ở chế độ `AUTOMATIC` hoặc alert Sales nếu ở chế độ `MANUAL`).
- [ ] **Quiet Hours Guard:** Viết logic hoãn gửi nhắc nhở trong khung giờ [22h00 - 07h00] sáng và tự động reschedule sang 08h00 sáng hôm sau.
- [ ] **Gateway Circuit Breaker (Cooldown):** Triển khai logic đếm lỗi trên Redis (errors count) và cách ly 15 phút (cooldown key) đối với các Provider lỗi liên tiếp 3 lần.
- [ ] **Multi-Provider Prompt Caching Adaptation:** Hiện thực hóa logic Prompt Caching thích ứng động cho 17 LLM providers chia làm 4 nhóm cơ chế xử lý (APC cho OpenAI/DeepSeek/Groq/Mistral/Azure/xAI/TogetherAI/Qwen/Replicate, explicit flags cho Anthropic/OpenRouter/Bedrock, cachedContents cho Gemini/VertexAI, và custom configs cho cohere/perplexity/voyage).
- [ ] **System Prompt Optimization:** Cấu trúc lại System Prompt và Tools tĩnh để tối ưu hóa tính năng Prompt Caching (đảm bảo phần tĩnh đứng đầu và vượt ngưỡng 1024 tokens đối với nhóm 1 & 2).
- [ ] **Redis Isolation Config:** Cấu hình kết nối chatbot queue tới `REDIS_QUEUE_URL` chuyên dụng (maxmemory-policy `noeviction`) để tránh mất job.
- [ ] **BullMQ Shared Connection & Cleanup Config:** Triển khai instance `ioredis` dùng chung cho Chatbot module để chia sẻ kết nối, cấu hình dọn dẹp job tự động (`removeOnComplete`, `removeOnFail`) và cơ chế retry backoff cho debounce và follow-up queues.
- [ ] **Migration Add Customer ID:** Tạo file migration thêm cột `customer_id` (UUID, soft link) vào bảng `chat_conversations`.
- [ ] **Handover Event Emission (Outbox):** Trong `ChatbotHandoverService.triggerHandover()`, sau khi cập nhật `state = MANUAL` và gửi tin nhắn cầu lịch sự cho khách, ghi bản ghi sự kiện `chat.handover_requested` vào bảng `chatbot_outbox_events` (trong cùng 1 Database Transaction) kèm payload đầy đủ: `conversationId`, `customerId`, `customerName`, `customerChannel`, `assigneeId`, `assigneeName`, `urgencyLevel`.
- [ ] **Handover Message Logic:** Triển khai `ChatbotHandoverService` tự động gửi tin nhắn phản hồi lịch sự ngay lập tức khi chuyển chế độ sang `MANUAL`. (Tin nhắn này gửi ra ngoài cho khách qua Facebook/Zalo API — khác với notification nội bộ cho Sales.)
- [ ] **Handback API Implementation:** Triển khai API controller `POST /api/v1/chat/conversations/:id/handback` kèm guard phân quyền `chat:write` và bắt buộc header `Idempotency-Key` (dùng Redis `SET NX` TTL 60s để chống duplicate).
- [ ] **Chatbot Outbox Sweeper:** Triển khai BullMQ Processor và Cronjob Sweeper để định kỳ quét `chatbot_outbox_events` và publish events ra ngoài Event Bus.

## Phase 5: Centralized Logging, Sync Job & Monitoring
- [ ] **Structured Logging:** Cấu hình Winston Logger để ghi log dạng JSON ra stdout phục vụ Promtail scrape.
- [ ] **Metrics Tracker:** Ghi nhận token usage, cost, latency và matching score của RAG vào log metadata.
- [ ] **Models Sync Job:** Triển khai Cron Job hàng ngày kết nối tới LiteLLM `/public/litellm_model_cost_map` để tự động upsert thông số model (max_tokens, costs, raw_metadata) và phân loại tier.
- [ ] **Manual Sync Endpoint:** Triển khai API `/api/v1/gateway/models/sync` cho phép Admin kích hoạt đồng bộ model bằng tay.
- [ ] **Admin Cost Analytics API:** Triển khai các API endpoints `/api/v1/gateway/metrics/summary` và `/metrics/raw` phục vụ vẽ biểu đồ báo cáo tài chính AI.

## Phase 6: Prompt Optimization & Evals Engine
- [ ] **Migration for Evals Tables:** Tạo file migration và Entities cho hai bảng `chat_eval_datasets` và `chat_eval_results`.
- [ ] **Language Detector Service:** Tích hợp gói npm phân tích ngôn ngữ offline, xây dựng `LanguageRouterService` nhận diện ngôn ngữ của khách hàng trong <= 1ms.
- [ ] **i18n Translation Configuration:** Tạo cấu trúc tệp JSON dịch thuật tĩnh cho `vi.json`, `en.json`, `zh.json` và tích hợp vào chatbot để gửi tin nhắn hệ thống (Handover, OOD) mà không tiêu hao LLM tokens.
- [ ] **Prompt Interpolation Manager:** Triển khai `PromptInterpolationManager` để tự động ghép nối System Prompt tĩnh, dynamic prompt variables từ Redis cache/DB và Language Output Directive.
- [ ] **LLMLingua-2 Compression Client:** Xây dựng HttpClient để kết nối tới LLMLingua-2 Microservice, thực hiện nén phân cấp RAG (0.4) và History (0.6) khi prompt vượt quá 3000 tokens.
- [ ] **Evals Engine Service:** Hiện thực hóa `EvalsService` chạy mô phỏng hội thoại cho tập dataset và tự động gửi API chấm điểm NLI Grounding/Relevance qua mô hình Judge lớn (`EVALS_JUDGE` ở Gateway).
- [ ] **Evals Execution API:** Khai báo API route `POST /api/v1/chatbot/evals/run` để Admin kích hoạt chạy evals kiểm thử prompt.

## Phase 7: Event Integration Tests
- [ ] **Handover Event Test:** Viết integration test kiểm tra khi `triggerHandover()` được gọi:
  - State chuyển thành `MANUAL` trong DB.
  - Tin nhắn cầu lịch sự được gửi ra ngoài cho khách.
  - Sự kiện `chat.handover_requested` được lưu vào `chatbot_outbox_events`.
- [ ] **Idempotency Integration Tests:** Kiểm tra các API POST admin và handback xử lý đúng khi trùng `Idempotency-Key`.
- [ ] **No Duplicate Notification Test:** Kiểm tra Chatbot Module không tự gửi WebSocket trực tiếp cho Sales (chức năng đó thuộc Notification Module).
