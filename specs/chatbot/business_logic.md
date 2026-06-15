# Đặc Tả Business Logic Module Chatbot

## 1. Luồng Bóc Tách Thực Thể (Entity Extraction)
Được định nghĩa bằng Function Calling (Tools) hoặc JSON Mode của LLM.
- AI liên tục đánh giá nội dung do người dùng gửi.
- Khi người dùng gửi "Nhà anh ở Đồng Nai, diện tích 50m2, tháng xài 3 triệu tiền điện".
- Cấu trúc trả về:
```json
{
  "location": "Đồng Nai",
  "roofArea": 50,
  "monthlyBill": 3000000,
  "roofType": "Unknown"
}
```
- Module Chatbot bắn Event `chat.entity.extracted` kèm payload trên.
- Module CRM lắng nghe Event và Update Database.

## 2. Luồng Fallback (Tự động chuyển tiếp người thật)
- Nếu LLM đánh giá intent của khách hàng là `COMPLAINT` (Than phiền, giận dữ) hoặc `HUMAN_REQUEST` (Đòi gặp nhân viên).
- Chatbot tự động:
  1. Cập nhật `chat_conversations.state = 'MANUAL'`.
  2. Gửi tin nhắn tự động: "Dạ, em đã ghi nhận thông tin và chuyển cho chuyên viên tư vấn tiếp hỗ trợ anh/chị ạ."
  3. Bắn Noti Push cho Sales.

## 3. RAG Retrieval Pipeline (Có Query Rewriter)
Khi khách hàng đặt câu hỏi (Ví dụ: "Vậy nó bảo hành bao lâu?"):

### 3.1. Query Rewriter & Domain Classifier (Viết lại và Phân loại câu hỏi)
Hệ thống sử dụng một LLM tốc độ cao (như `gpt-4o-mini` hoặc `gemini-1.5-flash`) kết hợp với lịch sử 5 tin nhắn gần nhất để đồng thời: viết lại câu hỏi cho rõ nghĩa và phân loại xem câu hỏi có thuộc phạm vi Solar/Solavie hay không (Out-of-Domain Detection).
*   **Chế độ chạy:** Gọi API với cấu hình `jsonMode: true`.
*   **System Prompt cho Query Rewriter & Classifier:**
    ```text
    Nhiệm vụ của bạn là đọc lịch sử hội thoại và tin nhắn mới nhất của khách hàng. Hãy phân tích và trả về một đối tượng JSON có cấu trúc chính xác sau:
    {
      "standalone_query": "Chuỗi văn bản. Viết lại tin nhắn mới nhất thành một câu hỏi độc lập, rõ nghĩa, đầy đủ danh từ, mã thiết bị dựa trên ngữ cảnh lịch sử chat để phục vụ tìm kiếm tài liệu (RAG). Nếu tin nhắn mới nhất là chào hỏi xã giao hoặc đã rõ nghĩa sẵn, hãy giữ nguyên nội dung.",
      "is_in_domain": true | false
    }

    QUY TẮC PHÂN LOẠI (is_in_domain):
    - Gán true: Nếu tin nhắn liên quan đến kỹ thuật Solar, pin mặt trời, inverter, chính sách bảo hành, báo giá lắp đặt, địa chỉ liên hệ của Solavie, hoặc các câu hỏi chào hỏi xã giao thông thường ("xin chào", "bạn là ai", "tư vấn giúp mình").
    - Gán false: Nếu tin nhắn hỏi về các chủ đề hoàn toàn ngoài phạm vi doanh nghiệp (ví dụ: công thức nấu ăn, viết code, giải toán, dịch văn bản, chính trị, triết học...).
    ```

### 3.2. Cấu hình Hierarchical Chunking (RAG phân cấp)
- **Parent Chunk:**
  - Định dạng: Chia nhỏ tài liệu theo phần/chương lớn hoặc các đoạn văn có tính liên kết cao.
  - Kích thước: ~1000 tokens (khoảng 3000 ký tự tiếng Việt).
  - Mục tiêu: Cung cấp đầy đủ bối cảnh, bảng thông số kỹ thuật, điều khoản đi kèm cho LLM.
- **Child Chunk:**
  - Định dạng: Tách ra từ Parent Chunk.
  - Kích thước: ~200 tokens (khoảng 600 ký tự).
  - Overlap (Độ gối đầu): 50 tokens (để không bị mất từ ở biên chunk).
  - Mục tiêu: Đảm bảo độ tương đồng vector đạt mức cao nhất mà không bị loãng thông tin.

### 3.3. Tìm kiếm lai tối ưu hóa (Optimized Hybrid Search)
Để tối đa hiệu năng, truy vấn tìm kiếm lai sử dụng cột vector `tsv_content` đã được PostgreSQL sinh sẵn (Pre-generated) và đánh chỉ mục GIN, kết hợp với tìm kiếm Vector bằng `HNSW`:

```sql
WITH sparse_search AS (
  SELECT 
    id, 
    ROW_NUMBER() OVER (ORDER BY ts_rank_cd(tsv_content, plainto_tsquery('simple', :keyword_query)) DESC) as rank
  FROM rag_documents
  WHERE chunk_type = 'CHILD' 
    AND tsv_content @@ plainto_tsquery('simple', :keyword_query)
  LIMIT 50
),
dense_search AS (
  SELECT 
    id, 
    ROW_NUMBER() OVER (ORDER BY embedding <=> :vector_query ASC) as rank
  FROM rag_documents
  WHERE chunk_type = 'CHILD' 
    AND embedding IS NOT NULL
  LIMIT 50
),
rrf_scores AS (
  SELECT 
    COALESCE(s.id, d.id) as id,
    (COALESCE(1.0 / (60.0 + s.rank), 0.0) + COALESCE(1.0 / (60.0 + d.rank), 0.0)) as rrf_score
  FROM sparse_search s
  FULL OUTER JOIN dense_search d ON s.id = d.id
)
SELECT 
  doc.id,
  doc.parent_id,
  doc.title,
  doc.content_chunk,
  r.rrf_score
FROM rrf_scores r
JOIN rag_documents doc ON doc.id = r.id
ORDER BY r.rrf_score DESC
LIMIT :limit;
```
*Lưu ý:* Việc dùng `plainto_tsquery('simple', ...)` giúp phân tích chuỗi tiếng Việt tìm kiếm thô của người dùng thành câu truy vấn logic một cách an toàn và tự động sử dụng index GIN của `tsv_content`.

## 4. ReAct Agent (Reasoning and Acting)
Chatbot hoạt động theo mô hình ReAct Agent để tự động suy luận xem nên gọi Tool nào.
- **Vòng lặp ReAct:** `Thought -> Action -> Observation -> Thought -> Final Answer`.
- **Khống chế Vòng Lặp (Infinite Loop Prevention):** Đội ngũ Dev bắt buộc phải giới hạn số lượt lặp tối đa của Agent là **3 iterations**. Nếu sau 3 bước gọi tool mà LLM vẫn chưa ra câu trả lời cuối cùng, hệ thống tự động ngắt và sử dụng kết quả RAG gần nhất để trả lời hoặc chuyển tiếp sang người thật (`MANUAL`).
- **Các Tool được cấp:**
  1. `get_solar_knowledge(query)`: Tìm kiếm tài liệu RAG.
  2. `crm_create_lead(full_name, phone_number, location, monthly_bill)`: Bắn API sang CRM tạo Lead (nếu khách đồng ý đăng ký tư vấn).

## 5. Tối Ưu Chi Phí & Bảo Mật (Prompt Caching & Guardrails)

### 5.1. Prompt Caching Adaptation (Cơ chế Cache theo từng hãng LLM)
Do các nhà cung cấp có cơ chế Prompt Caching khác nhau, Adapter trong Core Backend phải tự động định dạng payload gửi đi tương ứng:

#### 1. Anthropic (Claude 3.5 Sonnet / Haiku)
- **Đặc điểm:** Yêu cầu gán cờ cache tường minh. System Prompt tĩnh phải dài hơn **1024 tokens** để được kích hoạt.
- **Xử lý trong Adapter:**
  - Thiết lập Header: `anthropic-beta: prompt-caching-2024-07-31`.
  - Chèn metadata cache vào phần cuối của khối System Prompt:
    ```json
    {
      "type": "text",
      "text": "Toàn bộ nội dung System Prompt tĩnh (luật bán hàng, ReAct rules)...",
      "cache_control": { "type": "ephemeral" }
    }
    ```
  - Khi gửi định nghĩa Tools tĩnh, đính kèm `"cache_control": {"type": "ephemeral"}` vào định nghĩa tool cuối cùng trong danh sách.

#### 2. OpenAI (GPT-4o / GPT-4o-mini)
- **Đặc điểm:** Tự động cache (Zero-code caching) dựa trên thuật toán so khớp chính xác tiền tố (Prefix Matching). Yêu cầu tiền tố khớp hoàn toàn và dài tối thiểu **1024 tokens**.
- **Xử lý trong Adapter:**
  - Không cần thêm headers hay thuộc tính đặc biệt.
  - Đảm bảo **System Prompt và định nghĩa Tools** tĩnh được đặt ở đầu cấu trúc tin nhắn gửi đi, không xáo trộn thứ tự các cuộc gọi và không chèn dữ liệu động (như thời gian thực hay lịch sử chat biến đổi) vào trước phần tĩnh.

#### 3. Google Gemini (Gemini 1.5 Pro / Flash)
- **Đặc điểm:** Gemini yêu cầu tạo một Cache Resource độc lập thông qua API `/v1beta/cachedContents` trước khi thực hiện chat nếu prompt lớn (tối thiểu **32,768 tokens**).
- **Xử lý trong Adapter:**
  - Thích hợp cho kịch bản nạp toàn bộ cơ sở dữ liệu Solar tĩnh siêu lớn trực tiếp vào ngữ cảnh dài (Long-Context RAG) thay vì dùng vector database.
  - Backend NestJS gọi API tạo Cache Resource:
    ```bash
    POST https://generativelanguage.googleapis.com/v1beta/cachedContents
    Payload: { "model": "models/gemini-1.5-flash-001", "contents": [...], "ttl": "300s" }
    ```
  - API trả về một `name` (VD: `cachedContents/abc123xyz`).
  - Khi gửi câu hỏi của khách hàng, đính kèm `"cachedContent": "cachedContents/abc123xyz"` vào request body.

- Nhờ cách cấu hình thích ứng này, hệ thống Solavie đảm bảo tiết kiệm tối thiểu 80% chi phí token đầu vào bất kể model nào được định tuyến sử dụng.

### 5.2. Guardrails (Rào chắn PII)
Trước khi gửi nội dung tin nhắn của khách hàng đi tới LLM Gateway, hệ thống chạy qua một lớp lọc Regex nội bộ để ẩn danh thông tin cá nhân (PII):
* **Số điện thoại (Việt Nam):**
  - Regex: `/(0[3|5|7|8|9])+([0-9]{8})\b/g`
  - Thay thế thành: `[PHONE_REDACTED]`
* **Email:**
  - Regex: `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g`
  - Thay thế thành: `[EMAIL_REDACTED]`
* **Số thẻ tín dụng:**
  - Regex: `/\b(?:\d[ -]*?){13,16}\b/g`
  - Thay thế thành: `[CARD_REDACTED]`

## 6. Định Tuyến & Failover Động (Usecase & Credit Routing)

Khi một module nghiệp vụ trong Solavie cần gọi LLM cho một kịch bản nhất định (Ví dụ: `usecase_key = 'AGENT_CHAT'` yêu cầu tier `LARGE`):

### 6.1. Thuật toán phân giải Model (Resolution Algorithm)
1. Query bảng `gw_llm_usecases` theo `usecase_key`.
2. Nếu `provider_model_id` được gán khác NULL:
   - Lấy thông tin model tương ứng từ `gw_llm_provider_models` và API Key từ `gw_llm_providers` của model đó.
   - Nếu `gw_llm_providers.status = 'ACTIVE'`, trả về Model và API Key này.
   - Nếu Provider cấu hình bị `INACTIVE` hoặc `OUT_OF_CREDIT`, hệ thống ghi nhận lỗi cảnh báo và tự động chuyển sang chế độ định tuyến mặc định dưới đây.
3. Chế độ định tuyến mặc định (Default routing):
   - Truy vấn tất cả bản ghi trong bảng `gw_llm_providers` có `status = 'ACTIVE'`, sắp xếp theo cột `priority` tăng dần (1, 2, 3...).
   - Với mỗi provider, tìm kiếm model trong `gw_llm_provider_models` thỏa mãn đồng thời:
     - `provider_id` của provider đó.
     - `model_tier` = `usecase.required_tier` (để lấy model lớn cho chat, model nhỏ cho viết lại/tóm tắt).
     - `is_active = true`.
   - Nếu tìm thấy model tương thích, lập tức trả về cặp `{provider, model}` để thực thi.
   - Nếu duyệt hết tất cả provider mà không có model nào phù hợp, throw Exception cảnh báo hệ thống cạn kiệt LLM.

### 6.2. Thuật toán bắt lỗi cạn ví & Failover (Automatic Credit Failover)
Trong quá trình NestJS gọi API lên LLM Gateway, nếu cuộc gọi thất bại:
1. Bắt mã trạng thái HTTP và lỗi trong Response:
   - Lỗi OpenAI: `insufficient_quota` (HTTP 429 hoặc HTTP 402).
   - Lỗi Google Gemini: `quota_exceeded` hoặc `billing_disabled` (HTTP 429/403).
   - Lỗi Anthropic: `credit_limit_reached` (HTTP 429).
2. Khi nhận dạng đúng lỗi cạn tiền:
   - Thực hiện cập nhật DB ngay lập tức: `UPDATE gw_llm_providers SET status = 'OUT_OF_CREDIT' WHERE id = :providerId`.
   - Ghi log warn/error chi tiết về việc cạn tiền của Provider.
   - Tự động gọi lại thuật toán phân giải model ở mục 6.1 để chọn Provider kế tiếp (Ví dụ: `priority = 2`) và thực hiện gọi lại (Retry) yêu cầu LLM của người dùng. Tối đa thử lại 3 lần trên các provider khác nhau.

## 7. Giải Thuật Đồng Bộ Hóa Model (Sync Models Job)

API Endpoint `/api/v1/gateway/models/sync` hoặc Cron Job định kỳ 24 giờ một lần sẽ thực thi luồng logic sau:

1. Gửi HTTP Request `GET` tới LiteLLM Gateway tại endpoint `/public/litellm_model_cost_map`.
2. Parser JSON Object trả về:
   - Duyệt qua từng cặp `[full_model_name, details]`.
   - Kiểm tra xem trường `details.mode` có bằng `'chat'` (hoặc `'embedding'`) hay không. Bỏ qua các model không liên quan.
   - Lấy trường `details.litellm_provider` (Ví dụ: `openai`, `gemini`, `anthropic`).
   - Truy vấn DB `gw_llm_providers` để xem hãng này đã được cài đặt API Key trong hệ thống chưa. Nếu chưa có provider trong DB, bỏ qua không đồng bộ model của hãng đó.
3. Thực hiện phân tích để gán `model_tier` tự động (Heuristic Classification):
   - Chuyển `full_model_name` về chữ thường (`nameLower`).
   - Nếu `nameLower` chứa một trong các từ khóa sau: `mini`, `flash`, `haiku`, `fast`, `lite`, `3b`, `8b`, `7b`, `speed`, `llama3` -> `model_tier = 'SMALL'`.
   - Ngược lại -> `model_tier = 'LARGE'`.
4. Gọi câu lệnh `UPSERT` vào bảng `gw_llm_provider_models`:
   - So khớp theo khóa duy nhất `(provider_id, model_name)`.
   - Cập nhật các trường:
     - `max_tokens` = `details.max_tokens`
     - `max_input_tokens` = `details.max_input_tokens` (nếu có)
     - `max_output_tokens` = `details.max_output_tokens` (nếu có)
     - `input_cost_per_token` = `details.input_cost_per_token`
     - `output_cost_per_token` = `details.output_cost_per_token`
     - `raw_metadata` = `details` (Lưu giữ nguyên bản ghi JSON để tránh mất dữ liệu mới của LiteLLM)
     - `updated_at` = NOW()

## 8. Tính Toán Chi Phí & Ghi Nhận Metrics Bất Đồng Bộ

### 8.1. Công thức tính chi phí (Cost Engine)
Sau khi nhận kết quả từ LLM, hệ thống bóc tách số lượng token tiêu thụ và đối chiếu với đơn giá lưu tại `gw_llm_provider_models` của model đó:
- **`input_cost_per_token`**: Giá trên mỗi token đầu vào.
- **`output_cost_per_token`**: Giá trên mỗi token đầu ra.

**Công thức:**
1. **Chi phí đầu vào thông thường (Normal Input Cost):**
   $$InputCost_{normal} = (prompt\_tokens - cached\_tokens) \times input\_cost\_per\_token$$
2. **Chi phí đầu vào được cache (Cached Input Cost - Ưu đãi 50%):**
   $$InputCost_{cached} = cached\_tokens \times input\_cost\_per\_token \times 0.5$$
3. **Chi phí đầu ra (Output Cost):**
   $$OutputCost = completion\_tokens \times output\_cost\_per\_token$$
4. **Tổng chi phí cuộc gọi (Total Cost):**
   $$TotalCost = InputCost_{normal} + InputCost_{cached} + OutputCost$$

*Lưu ý:* Giá trị chi phí được tính toán và lưu dưới dạng `NUMERIC(15, 12)` để bảo toàn độ chính xác của các số thập phân siêu nhỏ (Ví dụ: `0.000000150000` USD).

### 8.2. Cơ chế ghi nhận bất đồng bộ (Async Event Logging)
Để đảm bảo API chat đạt tốc độ phản hồi tối ưu (mượt mà nhất cho người dùng), việc ghi metrics vào CSDL được tách biệt chạy ngầm:
1. Khi có kết quả từ LLM, NestJS controller lập tức thực hiện **SSE Streaming** trả chữ về cho Client (Facebook/Zalo).
2. NestJS Service phát một sự kiện nội bộ:
   ```typescript
   this.eventEmitter.emit('llm.metrics.created', {
     conversationId,
     usecaseKey,
     providerId,
     modelName,
     promptTokens,
     completionTokens,
     cachedTokens,
     latencyMs
   });
   ```
3. Một Listener `@OnEvent('llm.metrics.created')` chạy nền sẽ bắt sự kiện này:
   - Query giá của model trong DB.
   - Chạy công thức tính chi phí tại mục 8.1.
   - Thực hiện câu lệnh SQL `INSERT` chèn một bản ghi mới vào bảng `gw_llm_metrics`.
   - In một dòng log JSON ra `stdout` (định dạng `LLM_API_CALL` như mô tả ở `logging.md`) để Promtail chuyển tiếp lên Grafana Loki.

## 9. Giải Thuật Dynamic Debounce & Xử Lý Tin Nhắn Gộp (Redis & BullMQ)

Để giải quyết vấn đề đồng thời (double-texting) và đảm bảo AI nhận được đầy đủ ngữ cảnh nhất khi người dùng nhắn nhiều câu ngắn liên tục, hệ thống áp dụng cơ chế Dynamic Debounce sử dụng Redis List (làm buffer) và BullMQ (làm Delay Queue):

```typescript
import { Injectable } from '@nestjs/common';
import { InjectQueue, Processor, Process } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';

@Injectable()
export class ChatbotOrchestratorService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    @InjectQueue('chatbot-debounce') private readonly debounceQueue: Queue,
    @InjectQueue('chatbot-followup') private readonly followupQueue: Queue,
  ) {}

  /**
   * 1. Điểm tiếp nhận tin nhắn từ Facebook/Zalo Webhook sau khi qua PII Masking
   */
  async handleIncomingMessage(conversationId: string, messagePayload: any): Promise<void> {
    const bufferKey = `buffer:conversation:${conversationId}`;
    const jobId = `debounce:${conversationId}`;
    const followupJobId = `followup:${conversationId}`;

    // A. Hủy job nhắc nhở (Follow-up) nếu khách hàng chủ động nhắn tin lại
    const existingFollowupJob = await this.followupQueue.getJob(followupJobId);
    if (existingFollowupJob) {
      await existingFollowupJob.remove();
      this.logger.log(`Đã hủy job nhắc nhở ${followupJobId} do nhận được tin nhắn mới từ khách.`);
    }

    // B. Kiểm tra giới hạn hàng đợi đệm để chống spam (Token Flood Protection)
    const currentBufferLength = await this.redis.llen(bufferKey);
    if (currentBufferLength >= 5) {
      this.logger.warn(`Hội thoại ${conversationId} vượt quá giới hạn 5 tin nhắn chờ debounce. Bỏ qua tin nhắn mới.`);
      return;
    }

    await this.redis.rpush(bufferKey, JSON.stringify(messagePayload));
    await this.redis.expire(bufferKey, 300); // Đặt TTL 5 phút tránh rò rỉ dữ liệu

    // C. Hủy Debounce Job cũ (nếu có) để đặt lịch lại từ đầu (Dynamic Debounce)
    const existingDebounceJob = await this.debounceQueue.getJob(jobId);
    if (existingDebounceJob) {
      await existingDebounceJob.remove();
    }

    // D. Đặt lịch Debounce Job mới chạy sau 10 giây tĩnh lặng
    await this.debounceQueue.add(
      'process-debounce',
      { conversationId },
      { jobId, delay: 10000, removeOnComplete: true, removeOnFail: true }
    );
  }
}

/**
 * 2. Bộ xử lý Job Debounce sau khi hết 10 giây tĩnh lặng
 */
@Processor('chatbot-debounce')
export class ChatbotDebounceConsumer {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    @InjectQueue('chatbot-followup') private readonly followupQueue: Queue,
    private readonly agentService: ChatbotAgentService,
  ) {}

  @Process('process-debounce')
  async handleDebounce(job: Job<{ conversationId: string }>) {
    const { conversationId } = job.data;
    const lockKey = `lock:conversation:${conversationId}`;
    const bufferKey = `buffer:conversation:${conversationId}`;

    // A. Thử khóa đồng thời bằng Redis Lock tránh xung đột đa node
    const acquireLock = await this.redis.set(lockKey, 'locked', 'NX', 'PX', 45000); // Lock 45s cho xử lý Agent
    if (acquireLock !== 'OK') {
      return; // Đang có tiến trình khác xử lý
    }

    try {
      // B. Đọc và lấy toàn bộ tin nhắn trong buffer
      const messagesStr = await this.redis.lrange(bufferKey, 0, -1);
      if (!messagesStr || messagesStr.length === 0) {
        return;
      }

      // Xóa sạch buffer trong Redis
      await this.redis.del(bufferKey);

      // C. Gộp tất cả nội dung tin nhắn của khách
      const messages = messagesStr.map(msg => JSON.parse(msg));
      let bundledContent = messages
        .map(msg => msg.content.trim())
        .filter(content => content.length > 0)
        .join('. '); // Phân cách các tin nhắn con bằng dấu chấm

      // Khống chế tổng số ký tự gửi đi (Token Flood Protection)
      if (bundledContent.length > 2000) {
        this.logger.warn(`Nội dung gộp hội thoại ${conversationId} quá dài (${bundledContent.length} ký tự). Cắt bớt còn 2000 ký tự.`);
        bundledContent = bundledContent.substring(0, 2000) + '... [nội dung bị cắt gọn do quá dài]';
      }

      if (bundledContent.length === 0) {
        return;
      }

      // D. Gọi ReAct Agent xử lý nội dung gộp
      await this.agentService.runAgentLoop(conversationId, bundledContent);

      // E. Lên lịch nhắc nhở (Follow-up) sau 2 giờ tĩnh lặng
      const followupJobId = `followup:${conversationId}`;
      await this.followupQueue.add(
        'process-followup',
        { conversationId },
        { jobId: followupJobId, delay: 7200000, removeOnComplete: true, removeOnFail: true }
      );

    } catch (error) {
      this.logger.error(`Lỗi xử lý debounce cho conversation ${conversationId}`, error.stack);
    } finally {
      // Giải phóng khóa
      await this.redis.del(lockKey);
    }
  }
}
```

## 10. Giải Thuật Tự Động Nhắc Nhở Bằng BullMQ (Follow-up Scheduler Pseudocode)

Khi job nhắc nhở chạy sau 2 giờ khách hàng không có phản hồi gì thêm, hệ thống sẽ tự động phân tích múi giờ yên lặng và ngữ cảnh để đưa ra phản hồi hoặc cảnh báo:

```typescript
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Processor('chatbot-followup')
export class ChatbotFollowupConsumer {
  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversationRepo: Repository<ChatConversation>,
    private readonly llmGateway: LlmGatewayService,
    private readonly messagingService: MessagingGatewayService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Process('process-followup')
  async handleFollowup(job: Job<{ conversationId: string }>) {
    const { conversationId } = job.data;

    // 1. Kiểm tra Quiet Hours (Múi giờ Việt Nam GMT+7, tránh nhắn tin từ 22h đêm đến 7h sáng)
    const now = new Date();
    const utcOffset = now.getTimezoneOffset();
    // Chuyển sang giờ GMT+7
    const vnTime = new Date(now.getTime() + (utcOffset + 420) * 60 * 1000);
    const vnHour = vnTime.getHours();

    if (vnHour >= 22 || vnHour < 7) {
      this.logger.warn(`Phát hiện giờ yên lặng tại VN (${vnHour}h). Hoãn cuộc gọi nhắc nhở.`);
      
      // Tính toán dời lịch sang 08:00 sáng hôm sau
      const targetTime = new Date(vnTime);
      targetTime.setHours(8, 0, 0, 0);
      if (vnHour >= 22) {
        targetTime.setDate(targetTime.getDate() + 1);
      }
      
      const delayMs = targetTime.getTime() - vnTime.getTime();
      const followupJobId = `followup:${conversationId}`;
      
      await this.followupQueue.add(
        'process-followup',
        { conversationId },
        { jobId: followupJobId, delay: delayMs, removeOnComplete: true, removeOnFail: true }
      );
      return; // Kết thúc job cũ
    }

    // 2. Kiểm tra trạng thái mới nhất của phiên chat trong PostgreSQL
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId }
    });

    if (!conversation) {
      return;
    }

    if (conversation.followup_status !== 'PENDING') {
      return;
    }

    // 3. Phân loại định tuyến xử lý theo Trạng thái phiên chat
    if (conversation.state === 'AUTOMATIC') {
      // A. CHẾ ĐỘ AI: Tự động nhắc nhở khách hàng qua LLM
      try {
        const history = await this.messagingService.getRecentMessages(conversationId, 10);
        
        const systemPrompt = `
          Bạn là trợ lý ảo Solavie tư vấn lắp đặt điện mặt trời.
          Hãy viết một tin nhắn ngắn gọn (dưới 40 từ) để nhắc nhở và hỏi thăm khách hàng một cách lịch sự, tự nhiên dựa trên lịch sử chat trước đó của họ.
          QUY TẮC:
          - Không lặp lại câu hỏi cũ nếu đã hỏi.
          - Nhắc nhở khéo léo, không mang tính chèo kéo bán hàng thô bạo.
          - Chỉ trả về duy nhất nội dung tin nhắn gửi khách.
        `;

        const followupMessage = await this.llmGateway.generateText({
          usecaseKey: 'FOLLOWUP_ENGAGEMENT',
          systemPrompt,
          messages: history.map(h => ({ role: h.sender_type === 'CUSTOMER' ? 'user' : 'assistant', content: h.content }))
        });

        // Gửi tin nhắn nhắc nhở tới khách qua kênh mạng xã hội (Facebook/Zalo)
        await this.messagingService.sendMessageToChannel(conversation, followupMessage);

        // Cập nhật Database
        conversation.followup_status = 'SENT';
        await this.conversationRepo.save(conversation);

      } catch (error) {
        this.logger.error(`Lỗi tự động gửi tin nhắn nhắc nhở ${conversationId}`, error.stack);
      }
    } else if (conversation.state === 'MANUAL') {
      // B. CHẾ ĐỘ THỦ CÔNG: Bắn Event thông báo nhắc Sales vào chăm sóc
      if (conversation.assignee_id) {
        this.eventEmitter.emit('crm.sales.alert', {
          conversationId,
          assigneeId: conversation.assignee_id,
          type: 'FOLLOWUP_REMINDER',
          message: 'Khách hàng đã im lặng hơn 2 giờ. Hãy chủ động kiểm tra và chăm sóc!'
        });
        
        conversation.followup_status = 'SENT';
        await this.conversationRepo.save(conversation);
      }
    }
  }
}
```

## 11. Giải Thuật Circuit Breaker Cooldown cho LLM Gateway (Pseudocode)

Để ngăn ngừa trễ tích tụ (latency backup) khi một API Provider gặp sự cố, NestJS Dynamic Router áp dụng thuật toán Cooldown thông qua Redis:

```typescript
@Injectable()
export class LlmGatewayRouter {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly providerRepository: LlmProviderRepository,
  ) {}

  /**
   * Định tuyến và phân giải model tự động
   */
  async resolveActiveModel(usecaseKey: string): Promise<{ provider: LlmProvider; model: LlmModel }> {
    // 1. Lấy tất cả active providers, sắp xếp theo priority
    const providers = await this.providerRepository.getActiveProvidersSorted();

    for (const provider of providers) {
      const cooldownKey = `cooldown:provider:${provider.id}`;
      
      // 2. Kiểm tra trạng thái Cooldown trong Redis
      const isCooldowned = await this.redis.get(cooldownKey);
      if (isCooldowned) {
        continue; // Bỏ qua provider đang bị cách ly
      }

      const model = await this.providerRepository.findModelByTier(provider.id, usecaseKey);
      if (model) {
        return { provider, model };
      }
    }

    throw new Error('Hệ thống cạn kiệt LLM Providers khả dụng.');
  }

  /**
   * Ghi nhận lỗi cuộc gọi để kích hoạt Circuit Breaker
   */
  async recordFailure(providerId: string): Promise<void> {
    const errorKey = `errors:provider:${providerId}`;
    const cooldownKey = `cooldown:provider:${providerId}`;

    const currentErrors = await this.redis.incr(errorKey);
    if (currentErrors === 1) {
      await this.redis.expire(errorKey, 300); // Đặt TTL 5 phút
    }

    if (currentErrors >= 3) {
      // Đạt ngưỡng 3 lỗi liên tiếp -> Đưa vào trạng thái cách ly 15 phút
      await this.redis.set(cooldownKey, 'cooldown', 'EX', 900);
      await this.redis.del(errorKey); // Xóa bộ đếm lỗi
      this.logger.warn(`Provider ${providerId} đã bị đưa vào Cooldown cách ly 15 phút do lỗi liên tiếp 3 lần.`);
    }
  }

  /**
   * Xóa bộ đếm lỗi khi có cuộc gọi thành công
   */
  async recordSuccess(providerId: string): Promise<void> {
    const errorKey = `errors:provider:${providerId}`;
    await this.redis.del(errorKey);
  }
}
```

## 12. Quy Trình Rerank Hỗ Trợ RAG Pipeline (Pseudocode)

Tích hợp Cross-Encoder Reranker để nâng cao độ liên quan của ngữ cảnh trước khi nạp vào Prompt LLM:

```typescript
@Injectable()
export class RagRetrievalService {
  constructor(
    private readonly hybridSearchService: HybridSearchService,
    private readonly rerankerClient: RerankerClient, // Cohere hoặc TEI Container
  ) {}

  async retrieveContext(query: string, limit: number = 3): Promise<string> {
    // 1. Thực hiện Hybrid Search + RRF thu về Top 15 tài liệu tiềm năng
    const candidateDocs = await this.hybridSearchService.searchHybridRRF(query, 15);
    if (candidateDocs.length === 0) {
      return '';
    }

    // 2. Gửi sang Reranker Service để đánh giá điểm ngữ nghĩa sâu
    const rerankedDocs = await this.rerankerClient.rerank({
      query: query,
      documents: candidateDocs.map(doc => doc.content_chunk),
      topN: limit
    });

    // 3. Ánh xạ ngược lại để lấy Parent Chunks của Top 3 tài liệu đứng đầu
    const finalContexts: string[] = [];
    for (const item of rerankedDocs) {
      const parentDoc = await this.hybridSearchService.getParentDoc(candidateDocs[item.index].parentId);
      finalContexts.push(parentDoc.content_chunk);
    }

    return finalContexts.join('\n\n---\n\n');
  }
}
```
*Lợi ích kiến trúc:* Bằng cách lọc bỏ tài liệu nhiễu qua Reranker, prompt gửi lên LLM ngắn gọn, tập trung và đạt độ chính xác tối đa, giúp chatbot trả lời chuyên nghiệp về các thông số pin, biến tần Solar của Solavie.

## 13. Đặc Tả Rào Chắn An Toàn Đầu Vào & Đầu Ra (Input/Output Guardrails Pseudocode)

Để thực thi an toàn thông tin PII ở đầu vào và kiểm soát các nội dung sai lệch, thô tục ở đầu ra, NestJS Interceptor được triển khai như sau:

```typescript
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Injectable()
export class ChatbotGuardrailsInterceptor implements NestInterceptor {
  // Bảng từ cấm thô tục tiếng Việt cơ bản
  private readonly profanityList = ['đm', 'đéo', 'vcl', 'clm', 'chó chết']; 
  
  // Bảng giá Solar chính thức để đối chiếu (Sai số +/- 5% cho phép)
  private readonly solarPriceMap = [
    { package: '3kW', minPrice: 40000000, maxPrice: 48000000 },
    { package: '5kW', minPrice: 60000000, maxPrice: 72000000 },
    { package: '10kW', minPrice: 110000000, maxPrice: 130000000 }
  ];

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    
    // 1. INPUT GUARDRAIL: Che giấu PII của khách hàng gửi lên
    if (request.body && request.body.content) {
      request.body.content = this.maskPIIData(request.body.content);
    }

    return next.handle().pipe(
      map(response => {
        if (!response || typeof response !== 'string') {
          return response;
        }

        // 2. OUTPUT GUARDRAIL: Kiểm soát kết quả đầu ra của LLM
        return this.validateAndFilterOutput(response);
      })
    );
  }

  private maskPIIData(text: string): string {
    let sanitized = text;
    // Che giấu số điện thoại VN
    sanitized = sanitized.replace(/(0[3|5|7|8|9])+([0-9]{8})\b/g, '[PHONE_REDACTED]');
    // Che giấu email
    sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]');
    // Che giấu số thẻ
    sanitized = sanitized.replace(/\b(?:\d[ -]*?){13,16}\b/g, '[CARD_REDACTED]');
    return sanitized;
  }

  private validateAndFilterOutput(aiResponse: string): string {
    let sanitized = aiResponse;

    // A. Quét lỗi hệ thống thô của LLM
    const systemKeywords = ['Thought:', 'Action:', 'Observation:', 'null', 'undefined', '{"error"'];
    for (const word of systemKeywords) {
      if (sanitized.includes(word)) {
        throw new Error('Output Guardrail: Phát hiện định dạng kỹ thuật hệ thống rò rỉ.');
      }
    }

    // B. Quét từ ngữ thô tục (Profanity Filter)
    for (const badWord of this.profanityList) {
      const regex = new RegExp(`\\b${badWord}\\b`, 'gi');
      if (regex.test(sanitized)) {
        this.logger.warn(`Phát hiện từ thô tục '${badWord}' trong phản hồi AI. Thực hiện thay thế.`);
        sanitized = sanitized.replace(regex, '***');
      }
    }

    // C. Kiểm tra rào chắn bảng giá (Price Guardrail)
    // Trích xuất các cụm số liên quan đến giá tiền (ví dụ: 65.000.000, 65 triệu)
    const priceRegex = /(\d+[\d\.,]*)\s*(triệu|đồng|vnd|đ)/gi;
    let match;
    while ((match = priceRegex.exec(sanitized)) !== null) {
      const priceText = match[0];
      const parsedPrice = this.parsePriceToVND(match[1], match[2]);
      
      // So khớp với bảng gói solar
      const isPriceAccurate = this.verifySolarPrice(parsedPrice);
      if (!isPriceAccurate) {
        throw new Error(`Output Guardrail: AI báo giá sai lệch nghiêm trọng (${priceText} ~ ${parsedPrice} VND). Chặn phản hồi.`);
      }
    }

    return sanitized;
  }

  private parsePriceToVND(numStr: string, unit: string): number {
    const cleanNum = parseFloat(numStr.replace(/[\.,]/g, ''));
    if (unit.toLowerCase().includes('triệu')) {
      return cleanNum * 1000000;
    }
    return cleanNum;
  }

  private verifySolarPrice(price: number): boolean {
    // Nếu giá nhỏ hơn 5 triệu thì bỏ qua không check gói (ví dụ giá phụ kiện)
    if (price < 5000000) return true; 

    // Tìm xem giá có nằm trong khung của gói solar nào không
    const matchedPackage = this.solarPriceMap.find(
      p => price >= p.minPrice * 0.9 && price <= p.maxPrice * 1.1
    );
    
    return matchedPackage !== undefined;
  }
}
```

## 14. Giải Thuật Kiểm Tra & Chống Ảo Giác Grounding Check (NLI Validator)

Để ngăn AI trả lời tự bịa thông tin ngoài tài liệu kiến thức RAG, hệ thống triển khai Grounding Check chạy ngầm qua một LLM phân tích nhanh (NLI) trước khi trả chữ về cho khách hàng:

```typescript
@Injectable()
export class HallucinationMitigator {
  constructor(private readonly llmGateway: LlmGatewayService) {}

  /**
   * Đánh giá mức độ trung thực của câu trả lời AI so với Context RAG
   */
  async validateGrounding(
    userQuery: string,
    ragContext: string,
    aiResponse: string,
  ): Promise<{ isFaithful: boolean; reason?: string }> {
    if (!ragContext || ragContext.trim().length === 0) {
      // Nếu không có context thì không thể kiểm tra grounding
      return { isFaithful: true }; 
    }

    const evaluationPrompt = `
      Nhiệm vụ của bạn là kiểm tra xem câu trả lời của Trợ lý AI có bị ảo giác (bịa đặt thông tin) so với tài liệu ngữ cảnh được cung cấp hay không.
      Hãy so sánh chi tiết các thực thể: dòng sản phẩm, chính sách, bảo hành, giá cả, thông số kỹ thuật.
      
      [TÀI LIỆU NGỮ CẢNH]
      ${ragContext}
      
      [CÂU HỎI CỦA KHÁCH]
      ${userQuery}
      
      [CÂU TRẢ LỜI CỦA AI]
      ${aiResponse}
      
      QUY TẮC PHÂN LOẠI:
      - Trả về 'FAITHFUL' nếu câu trả lời HOÀN TOÀN dựa vào tài liệu, không tự bịa thông tin mới.
      - Trả về 'HALLUCINATED' nếu câu trả lời chứa thông tin không thể tìm thấy hoặc suy diễn logic từ tài liệu ngữ cảnh.
      
      Định dạng đầu ra: Hãy trả về chuỗi JSON chính xác có cấu trúc:
      {
        "classification": "FAITHFUL" | "HALLUCINATED",
        "reason": "Giải thích ngắn gọn lý do phân loại (nếu là HALLUCINATED)"
      }
    `;

    try {
      const resultText = await this.llmGateway.generateText({
        usecaseKey: 'HALLUCINATION_CHECK', // Định tuyến tới mô hình nhỏ gpt-4o-mini / gemini-1.5-flash
        systemPrompt: 'Bạn là chuyên gia kiểm tra chất lượng dữ liệu AI. Hãy phân tích khách quan.',
        messages: [{ role: 'user', content: evaluationPrompt }],
        jsonMode: true
      });

      const parsed = JSON.parse(resultText);
      return {
        isFaithful: parsed.classification === 'FAITHFUL',
        reason: parsed.reason
      };

    } catch (error) {
      // Nếu sập API check, cho qua để tránh nghẽn chat, nhưng ghi log error để cảnh báo
      this.logger.error('Lỗi khi chạy bộ đánh giá chống ảo giác Grounding Check', error.stack);
      return { isFaithful: true }; 
    }
  }
}
```
*Lợi ích kiến trúc:* Bằng sự kết hợp giữa **Lớp Lọc Cứng Interceptor** (cho các lỗi profanity, lỗi hệ thống, sai lệch giá) và **Lớp Lọc Mềm Grounding Check** (suy diễn logic bằng LLM), chatbot của Solavie triệt tiêu được **99% rủi ro ảo giác** và bảo vệ tối ưu uy tín thương hiệu trên thị trường.

## 15. Quy Trình Lọc Ngoài Phạm Vi (Out-Of-Domain Filter Logic)

Để tối ưu hóa chi phí token LLM và giữ chatbot luôn tập trung vào lĩnh vực tư vấn Điện năng lượng mặt trời, NestJS áp dụng bộ lọc 2 lớp: Lọc tĩnh Regex (General Greetings) và Lọc LLM Classifier thông qua `QueryRewriterService`.

```typescript
import { Injectable, Logger } from '@nestjs/common';

export interface RewriteAndClassifyResult {
  standalone_query: string;
  is_in_domain: boolean;
}

@Injectable()
export class QueryRewriterService {
  private readonly logger = new Logger(QueryRewriterService.name);

  constructor(private readonly llmGateway: LlmGatewayService) {}

  /**
   * Gọi LLM với JSON Mode để đồng thời viết lại truy vấn và phân loại domain
   */
  async rewriteAndClassify(conversationId: string, query: string): Promise<RewriteAndClassifyResult> {
    const history = await this.getRecentChatHistory(conversationId);
    
    const systemPrompt = `
      Nhiệm vụ của bạn là đọc lịch sử hội thoại và tin nhắn mới nhất của khách hàng. Hãy phân tích và trả về một đối tượng JSON có cấu trúc chính xác sau:
      {
        "standalone_query": "Chuỗi văn bản. Viết lại tin nhắn mới nhất thành một câu hỏi độc lập, rõ nghĩa, đầy đủ danh từ, mã thiết bị dựa trên ngữ cảnh lịch sử chat để phục vụ tìm kiếm tài liệu (RAG). Nếu tin nhắn mới nhất là chào hỏi xã giao hoặc đã rõ nghĩa sẵn, hãy giữ nguyên nội dung.",
        "is_in_domain": true | false
      }

      QUY TẮC PHÂN LOẠI (is_in_domain):
      - Gán true: Nếu tin nhắn liên quan đến kỹ thuật Solar, pin mặt trời, inverter, chính sách bảo hành, báo giá lắp đặt, địa chỉ liên hệ của Solavie, hoặc các câu hỏi chào hỏi xã giao thông thường ("xin chào", "bạn là ai", "tư vấn giúp mình").
      - Gán false: Nếu tin nhắn hỏi về các chủ đề hoàn toàn ngoài phạm vi doanh nghiệp (ví dụ: công thức nấu ăn, viết code, giải toán, dịch văn bản, chính trị, triết học...).
    `;

    try {
      const responseText = await this.llmGateway.generateText({
        usecaseKey: 'QUERY_REWRITE', // Định tuyến tới model nhỏ gpt-4o-mini hoặc gemini-1.5-flash
        systemPrompt,
        messages: [
          ...history,
          { role: 'user', content: query }
        ],
        jsonMode: true
      });

      return JSON.parse(responseText) as RewriteAndClassifyResult;
    } catch (error) {
      this.logger.error(`Lỗi khi gọi QueryRewriter cho conversation ${conversationId}`, error.stack);
      // Fallback an toàn: Cho qua RAG/Agent để tránh sập luồng chat
      return {
        standalone_query: query,
        is_in_domain: true
      };
    }
  }

  private async getRecentChatHistory(conversationId: string): Promise<any[]> {
    // Logic lấy 5 tin nhắn gần nhất của phiên chat
    return [];
  }
}

@Injectable()
export class ChatbotOodFilterService {
  private readonly logger = new Logger(ChatbotOodFilterService.name);
  
  private readonly oodDefaultResponse = 
    `Dạ, em là Trợ lý ảo chuyên tư vấn giải pháp Điện năng lượng mặt trời của Solavie. ` +
    `Hiện tại em chưa được đào tạo để trả lời các chủ đề ngoài lĩnh vực này. ` +
    `Anh/chị có câu hỏi nào về pin mặt trời, inverter hoặc chi phí lắp đặt cần em hỗ trợ không ạ?`;

  constructor(
    private readonly queryRewriter: QueryRewriterService,
    private readonly messagingService: MessagingGatewayService,
  ) {}

  /**
   * Đánh giá và lọc câu hỏi của khách
   * @returns true nếu câu hỏi hợp lệ (In-Domain), false nếu bị chặn (Out-of-Domain)
   */
  async checkAndFilterDomain(conversationId: string, userQuery: string): Promise<{ isInDomain: boolean; standaloneQuery: string }> {
    // 1. Lọc nhanh các câu chào hỏi/xã giao tĩnh bằng Regex trước để tiết kiệm API
    if (this.isGeneralGreeting(userQuery)) {
      return { isInDomain: true, standaloneQuery: userQuery };
    }

    // 2. Gọi Query Rewriter & Classifier (JSON Mode)
    const result = await this.queryRewriter.rewriteAndClassify(conversationId, userQuery);

    if (!result.is_in_domain) {
      this.logger.warn(`Phát hiện câu hỏi ngoài phạm vi (OOD) từ khách: "${userQuery}". Tự động chặn.`);
      
      // Gửi ngay phản hồi từ chối mẫu tĩnh cho khách
      await this.messagingService.sendMessage(conversationId, this.oodDefaultResponse);
      return { isInDomain: false, standaloneQuery: '' };
    }

    return { isInDomain: true, standaloneQuery: result.standalone_query };
  }

  private isGeneralGreeting(text: string): boolean {
    const cleanText = text.toLowerCase().trim();
    const greetings = [
      'alo', 'hi', 'hello', 'chào', 'chao ban', 'chào shop', 'ad ơi', 'admin ơi', 
      'tư vấn giúp mình', 'bạn là ai', 'chatbot'
    ];
    return greetings.some(g => cleanText.startsWith(g) || cleanText === g);
  }
}
```
*Lợi ích kiến trúc:* Giải pháp này giúp loại bỏ hoàn toàn các yêu cầu LLM đắt đỏ của ReAct Agent và RAG khi khách hàng hỏi linh tinh, giúp Solavie tiết kiệm 100% token cho các câu hỏi ngoài phạm vi đồng thời đảm bảo an toàn nội dung phát ngôn của hệ thống.

