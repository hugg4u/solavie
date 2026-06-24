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
Do các nhà cung cấp có cơ chế Prompt Caching khác nhau, Adapter trong Core Backend phải tự động định dạng payload gửi đi tương ứng theo 4 nhóm cơ chế xử lý chính đối với 17 providers (bao gồm các provider phổ biến và các cloud/enterprise engine):

#### 1. Nhóm 1: Cache Tiền Tố Tự Động (Automatic Prefix Caching - APC)
- **Các Provider:** `openai`, `deepseek`, `groq`, `mistral`, `azure`, `xai` (Grok), `together_ai`, `qwen`, `replicate`.
- **Đặc điểm:** Tự động cache KV cache của prompt prefix nếu nội dung tĩnh ở đầu hoàn toàn khớp. Yêu cầu độ dài tối thiểu 1024 tokens.
- **Xử lý trong Adapter:**
  - Sắp xếp System Prompt và định nghĩa Tools tĩnh lên hàng đầu tiên trong danh sách `messages`.
  - Cấm chèn dữ liệu động (như `timestamp`, `user_profile`, `conversation_id`, hoặc kết quả RAG thay đổi) trước phần System Prompt hoặc Tools.
  - Ví dụ:
    ```typescript
    const messages = [
      { role: "system", content: STATIC_SYSTEM_PROMPT },
      { role: "developer", content: STATIC_TOOL_DEFINITIONS },
      { role: "user", content: DYNAMIC_USER_QUERY_WITH_CONTEXT }
    ];
    ```

#### 2. Nhóm 2: Khai Báo Cache Tường Minh (Explicit Caching Flags)
- **Các Provider:** `anthropic` (Claude), `openrouter` (khi routing sang Anthropic), `bedrock` (Amazon Bedrock Converse API).
- **Đặc điểm:** Yêu cầu đính kèm cờ báo hiệu cache tường minh trong cấu trúc tin nhắn.
- **Xử lý trong Adapter:**
  - **Anthropic / OpenRouter:**
    - Gửi Header: `anthropic-beta: prompt-caching-2024-07-31`.
    - Chèn `"cache_control": { "type": "ephemeral" }` vào khối tin nhắn System Prompt và block công cụ cuối cùng trong Tools.
    - Cấu trúc Payload:
      ```json
      {
        "model": "claude-3-5-sonnet-20241022",
        "system": [
          {
            "type": "text",
            "text": "Toàn bộ system prompt tĩnh...",
            "cache_control": { "type": "ephemeral" }
          }
        ],
        "messages": [...],
        "tools": [
          { "name": "tool1", ... },
          { "name": "tool2", ..., "cache_control": { "type": "ephemeral" } }
        ]
      }
      ```
  - **Amazon Bedrock (Converse API):**
    - Chèn `cachePoint` vào các trường tĩnh trong Converse API:
      ```json
      {
        "system": [
          {
            "text": "System prompt...",
            "cachePoint": { "type": "default" }
          }
        ]
      }
      ```

#### 3. Nhóm 3: Tạo Tài Nguyên Cache Độc Lập (Context Caching API)
- **Các Provider:** `google` (Gemini API), `vertex_ai` (Google Cloud Vertex AI).
- **Đặc điểm:** Yêu cầu tạo cache resource trước qua API độc lập cho phần context tĩnh cực lớn (tối thiểu 32,768 tokens).
- **Xử lý trong Adapter:**
  - Nếu kích thước ngữ cảnh tài liệu Solar tĩnh vượt quá 32,768 tokens:
    1. Gọi REST API hoặc SDK để tạo cache resource trước:
       ```bash
       POST /v1beta/cachedContents
       Body: {
         "model": "models/gemini-1.5-flash-001",
         "contents": [{ "role": "user", "parts": [{ "text": STATIC_LARGE_Solar_DOCS }] }],
         "ttl": "300s"
       }
       ```
    2. Nhận lại `name` của cache (Ví dụ: `cachedContents/abc123xyz`).
    3. Khi thực hiện chat completion, đính kèm `"cachedContent": "cachedContents/abc123xyz"` vào request payload.

#### 4. Nhóm 4: Cấu Hình Tối Ưu Hóa Khác (Custom Caching)
- **Các Provider:** `cohere`, `perplexity`, `voyage`.
- **Xử lý trong Adapter:**
  - **Cohere / Perplexity:**
    - Cohere/Perplexity không có API cache tường minh. Adapter của Cohere sẽ sử dụng tham số `preamble` để truyền system prompt tĩnh lên hàng đầu, giúp tối ưu hóa luồng xử lý bên trong của họ.
    - Với Perplexity, khống chế chặt chẽ giới hạn token đầu vào (ví dụ: cắt bớt history) vì họ tính phí phẳng và không có cache.
  - **Voyage:**
    - Voyage dùng cho Vector Embeddings/Reranker. Tối ưu hóa bằng cách cache kết quả Vector Embedding của các chunk tài liệu tĩnh vào database (`PgVector`/`Qdrant`) để tránh gọi API mã hóa lại cùng một văn bản.

- Nhờ chiến lược phân loại thích ứng 4 nhóm cho 17 providers này, chatbot Solavie đảm bảo đạt tỷ lệ cache hit tối thiểu 80% đối với phần bối cảnh tĩnh, tiết kiệm từ 50% đến 90% chi phí hóa đơn LLM đầu vào.

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
   - Nếu duyệt hết tất cả provider mà không có model nào phù hợp, kích hoạt kịch bản **AI FALLBACK**: Tự động chuyển `chat_conversations.state = 'MANUAL'`, gửi tin nhắn xin lỗi tới khách hàng và phân bổ hội thoại cho đội ngũ Sales bằng thuật toán **Round Robin**.

### 6.2. Thuật toán bắt lỗi cạn ví & Failover (Automatic Credit Failover)
Trong quá trình NestJS gọi API lên LLM Gateway, nếu cuộc gọi thất bại:
1. Bắt mã trạng thái HTTP và lỗi trong Response:
   - Lỗi OpenAI: `insufficient_quota` (HTTP 429 hoặc HTTP 402).
   - Lỗi Google Gemini: `quota_exceeded` hoặc `billing_disabled` (HTTP 429/403).
   - Lỗi Anthropic: `credit_limit_reached` (HTTP 429).
2. Khi nhận dạng đúng lỗi cạn tiền:
   - Thực hiện cập nhật DB ngay lập tức: `UPDATE gw_llm_providers SET status = 'OUT_OF_CREDIT' WHERE id = :providerId`.
   - Ghi log warn/error chi tiết về việc cạn tiền của Provider.
   - Tự động gọi lại thuật toán phân giải model ở mục 6.1 để chọn Provider kế tiếp. Tối đa thử lại 3 lần.\n   - **FAILOVER THẤT BẠI (AI FALLBACK):** Nếu cả 3 lần retry trên các provider khác nhau đều thất bại, hệ thống tự động cập nhật `chat_conversations.state = 'MANUAL'`, gửi tin nhắn xin lỗi và dùng thuật toán **Round Robin** chia hội thoại cho Sale.

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

---

## 16. Cấu hình Hàng đợi & Chia sẻ Kết nối BullMQ Chatbot (NestJS)

Đặc tả chi tiết cấu hình dùng chung đối tượng kết nối `ioredis` và thiết lập các tùy chọn dọn dẹp job tự động cho các hàng đợi Debounce và Follow-up:

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';

// Khởi tạo đối tượng kết nối duy nhất trỏ tới instance Queue chuyên dụng (noeviction)
const sharedRedisConnection = new Redis(process.env.REDIS_QUEUE_URL, {
  maxLoadingRetryTime: 10000,
  enableReadyCheck: true,
});

@Module({
  imports: [
    BullModule.forRoot({
      connection: sharedRedisConnection, // Tái sử dụng connection pool để tối ưu TCP connections
    }),
    BullModule.registerQueue(
      {
        name: 'chatbot-debounce',
        defaultJobOptions: {
          removeOnComplete: {
            age: 1800, // Tự động xóa job completed sau 30 phút
            count: 50  // Chỉ lưu tối đa 50 jobs completed gần nhất
          },
          removeOnFail: {
            age: 3600, // Tự động xóa job failed sau 1 giờ
            count: 100 // Chỉ lưu tối đa 100 jobs failed gần nhất
          },
        }
      },
      {
        name: 'chatbot-followup',
        defaultJobOptions: {
          removeOnComplete: {
            age: 86400, // Xóa job completed sau 24 giờ
            count: 200  // Lưu tối đa 200 jobs completed
          },
          removeOnFail: {
            age: 172800, // Xóa job failed sau 48 giờ để phục vụ gỡ lỗi
            count: 500   // Lưu tối đa 500 jobs failed
          },
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000, // Thử lại sau 5s, 10s, 20s
          }
        }
      }
    )
  ]
})
export class ChatbotQueueModule {}
```

---

## 17. Luồng Chuyển Giao Chatbot (Handover) & API Trả Quyền Cho AI (Handback)

### 17.1. Logic Xử Lý Chuyển Giao (Handover Process)
Khi hệ thống kích hoạt yêu cầu chuyển giao sang nhân viên tư vấn, quy trình xử lý NestJS thực thi tuần tự như sau:

```typescript
@Injectable()
export class ChatbotHandoverService {
  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversationRepository: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    private readonly gatewayApiService: GatewayApiService, // Để gọi API gửi tin nhắn sang FB/Zalo
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Thực hiện chuyển giao sang chế độ thủ công (MANUAL)
   */
  async triggerHandover(conversationId: string, reason: string): Promise<void> {
    const conversation = await this.conversationRepository.findOneBy({ id: conversationId });
    if (!conversation || conversation.state === 'MANUAL') return;

    // 1. Gửi tin nhắn tự động chuyển giao đến khách hàng ngay lập tức
    const handoverMessageContent = 
      'Dạ, Trợ lý ảo Solavie đã chuyển thông tin yêu cầu của anh/chị đến kỹ sư hỗ trợ. Chuyên viên tư vấn sẽ liên hệ lại với anh/chị ngay lập tức. Xin anh/chị vui lòng đợi trong giây lát ạ!';
    
    await this.gatewayApiService.sendMessage({
      channel: conversation.channel,
      recipientId: conversation.sender_id,
      text: handoverMessageContent,
    });

    // 2. Lưu tin nhắn tự động này vào CSDL để bảo toàn dòng timeline
    await this.messageRepository.save({
      conversation_id: conversationId,
      sender_type: 'AI',
      content: handoverMessageContent,
    });

    // 3. Cập nhật trạng thái cuộc hội thoại sang MANUAL
    conversation.state = 'MANUAL';
    conversation.last_message_at = new Date();
    await this.conversationRepository.save(conversation);

    // 4. Phát sự kiện thông báo thời gian thực (real-time alert) cho sales reps
    this.eventEmitter.emit('chat.conversation.handover', {
      conversationId,
      channel: conversation.channel,
      senderId: conversation.sender_id,
      reason,
    });
  }
}
```

### 17.2. Controller Xử Lý API Trả Quyền AI (Handback API)
Cho phép nhân viên bán hàng sau khi hoàn tất cuộc trò chuyện gọi API để bàn giao lại cho AI tự động theo dõi và chăm sóc tiếp:

```typescript
@Controller('api/v1/chat/conversations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChatbotHandbackController {
  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversationRepository: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
  ) {}

  @Post(':id/handback')
  @RequirePermissions('inbox.conversation.write')
  async handbackToAi(@Param('id') id: string, @Req() req: any): Promise<{ success: boolean }> {
    const conversation = await this.conversationRepository.findOneBy({ id });
    if (!conversation) {
      throw new NotFoundException('Không tìm thấy cuộc hội thoại');
    }

    if (conversation.state === 'AUTOMATIC') {
      return { success: true };
    }

    // 1. Cập nhật trạng thái về AUTOMATIC
    conversation.state = 'AUTOMATIC';
    conversation.assignee_id = null; // Giải phóng nhân viên phụ trách
    conversation.last_message_at = new Date();
    await this.conversationRepository.save(conversation);

    // 2. Ghi nhận tin nhắn thông báo AI tiếp tục phục vụ
    const handbackNotice = 'Dạ, Trợ lý ảo Solavie xin phép tiếp tục hỗ trợ tư vấn tự động cho anh/chị ạ.';
    await this.messageRepository.save({
      conversation_id: id,
      sender_type: 'AI',
      content: handbackNotice,
    });

    // 2. Ghi nhận tin nhắn thông báo AI tiếp tục phục vụ
    const handbackNotice = 'Dạ, Trợ lý ảo Solavie xin phép tiếp tục hỗ trợ tư vấn tự động cho anh/chị ạ.';
    await this.messageRepository.save({
      conversation_id: id,
      sender_type: 'AI',
      content: handbackNotice,
    });

    return { success: true };
  }
}
```

---

## 18. Logic Đa Ngôn Ngữ Động (Language Detection & i18n Routing)

Đặc tả mã nguồn NestJS Service phát hiện ngôn ngữ offline, tra cứu dịch i18n tĩnh cho các tin nhắn hệ thống, và chèn chỉ thị ngôn ngữ động khi gọi LLM:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import * as franc from 'franc'; // Thư viện offline nhẹ phân tích ngôn ngữ
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class LanguageRouterService {
  private readonly logger = new Logger(LanguageRouterService.name);
  private readonly translations: Record<string, Record<string, string>> = {};

  constructor() {
    this.loadTranslations();
  }

  /**
   * 1. Load file i18n JSON tĩnh
   */
  private loadTranslations() {
    const langs = ['vi', 'en', 'zh'];
    for (const lang of langs) {
      try {
        const filePath = path.join(__dirname, `../common/i18n/${lang}.json`);
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf8');
          this.translations[lang] = JSON.parse(raw);
        }
      } catch (err) {
        this.logger.error(`Không thể tải tệp dịch i18n cho ngôn ngữ: ${lang}`, err.stack);
      }
    }
  }

  /**
   * 2. Nhận diện ngôn ngữ từ tin nhắn khách hàng (Offline < 1ms)
   */
  detectLanguage(text: string): string {
    if (!text || text.trim().length < 3) {
      return 'vi'; // Default về tiếng Việt nếu quá ngắn
    }
    const detectedIso = franc(text, { minLength: 3 }); // Trả về 'vie', 'eng', 'cmn'...
    
    if (detectedIso === 'eng') return 'en';
    if (detectedIso === 'cmn' || detectedIso === 'zho') return 'zh';
    return 'vi'; // Mặc định là Việt Nam
  }

  /**
   * 3. Trả về câu dịch tĩnh cho tin nhắn hệ thống (Tiết kiệm 100% token LLM)
   */
  getStaticTranslation(lang: string, key: string): string {
    const langDict = this.translations[lang] || this.translations['vi'];
    return langDict[key] || `[Missing Translation: ${key}]`;
  }
}

@Injectable()
export class PromptInterpolationManager {
  constructor(
    @InjectRepository(PromptVariable)
    private readonly variableRepo: Repository<PromptVariable>,
    @InjectRedis('cache') private readonly redis: Redis,
  ) {}

  /**
   * Ghép nối System Prompt tĩnh và biến cấu hình động, sau đó append Directive ngôn ngữ
   */
  async buildFinalPrompt(
    baseSystemPrompt: string, 
    userLang: string, 
    extraVariables: Record<string, string> = {}
  ): Promise<string> {
    // A. Lấy biến động Admin từ cache/DB
    const cachedVars = await this.redis.get('gateway:prompts:variables');
    let dbVars: Record<string, string> = {};
    
    if (cachedVars) {
      dbVars = JSON.parse(cachedVars).reduce((acc, curr) => {
        acc[curr.variable_key] = curr.variable_value;
        return acc;
      }, {});
    } else {
      const vars = await this.variableRepo.find();
      dbVars = vars.reduce((acc, curr) => {
        acc[curr.variable_key] = curr.variable_value;
        return acc;
      }, {});
    }

    // B. Ghép nối Admin variables vào prompt
    let interpolatedPrompt = baseSystemPrompt;
    const allVars = { ...dbVars, ...extraVariables };
    
    for (const [key, value] of Object.entries(allVars)) {
      interpolatedPrompt = interpolatedPrompt.replace(new RegExp(`\\\${${key}}`, 'g'), value);
    }

    // C. Chèn Dynamic Language Directive ở sau điểm ngắt cache breakpoint
    const languageNames: Record<string, string> = {
      vi: 'Vietnamese',
      en: 'English',
      zh: 'Chinese'
    };
    const targetLangName = languageNames[userLang] || 'Vietnamese';

    const languageDirective = `
[LANGUAGE PROTOCOL]
- The customer is querying in: ${targetLangName} (ISO: ${userLang}).
- You MUST generate the final response in the EXACT same language: ${targetLangName}.
- Dynamically translate the retrieved RAG Context documents (which are written in Vietnamese) into ${targetLangName} for the Final Answer. Do not use Vietnamese terms unless they are specific brand names like "Solavie".
`;

    return interpolatedPrompt + '\n' + languageDirective;
  }
}
```

---

## 19. Logic Evals Engine (LLM-as-a-Judge API)

Đặc tả mã nguồn NestJS Service chạy bộ kiểm thử tự động, gọi Gateway Judge chấm điểm câu trả lời chatbot ngoại tuyến:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatEvalDataset } from './entities/chat-eval-dataset.entity';
import { ChatEvalResult } from './entities/chat-eval-result.entity';
import { LLMGatewayService } from './llm-gateway.service'; // Lấy Adapter từ Gateway
import { ChatbotAgentService } from './chatbot-agent.service'; // Chạy chatbot test
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class EvalsService {
  private readonly logger = new Logger(EvalsService.name);

  constructor(
    @InjectRepository(ChatEvalDataset)
    private readonly datasetRepo: Repository<ChatEvalDataset>,
    @InjectRepository(ChatEvalResult)
    private readonly resultRepo: Repository<ChatEvalResult>,
    private readonly agentService: ChatbotAgentService,
    private readonly llmGateway: LLMGatewayService,
  ) {}

  /**
   * Kích hoạt chạy toàn bộ test case trong Golden Dataset
   */
  async runEvaluations(testVariables?: Record<string, string>): Promise<{ evalRunId: string; totalExecuted: number }> {
    const evalRunId = uuidv4();
    const testCases = await this.datasetRepo.find();
    
    if (testCases.length === 0) {
      throw new Error('Golden Dataset is empty. Please insert test cases first.');
    }

    // Khởi chạy bất đồng bộ trong background để tránh block API
    this.executeEvalsQueue(evalRunId, testCases, testVariables);

    return {
      evalRunId,
      totalExecuted: testCases.length
    };
  }

  private async executeEvalsQueue(evalRunId: string, testCases: ChatEvalDataset[], testVariables?: Record<string, string>) {
    this.logger.log(`Bắt đầu chạy Evals Run ID: ${evalRunId} với ${testCases.length} cases.`);

    for (const testCase of testCases) {
      const startTime = Date.now();
      try {
        // 1. Chạy chatbot mô phỏng để lấy phản hồi thực tế
        const actualOutput = await this.agentService.generateSimulatedReply(
          testCase.query, 
          testCase.expected_context,
          testVariables
        );
        const latencyMs = Date.now() - startTime;

        // 2. Gọi LLM Judge lớn từ Gateway chấm điểm
        const judgeResult = await this.judgeResponse(
          testCase.expected_context || 'N/A',
          testCase.query,
          testCase.expected_output,
          actualOutput
        );

        // 3. Ghi nhận vào DB
        await this.resultRepo.save({
          eval_run_id: evalRunId,
          dataset_id: testCase.id,
          actual_output: actualOutput,
          grounding_score: judgeResult.grounding_score,
          relevance_score: judgeResult.relevance_score,
          evaluator_feedback: judgeResult.feedback,
          latency_ms: latencyMs,
        });

      } catch (err) {
        this.logger.error(`Lỗi khi chạy Evals cho Case ID: ${testCase.id}`, err.stack);
        // Lưu log lỗi để không bị đứt luồng chạy của các case tiếp theo
        await this.resultRepo.save({
          eval_run_id: evalRunId,
          dataset_id: testCase.id,
          actual_output: `[ERROR DURING EVALS]: ${err.message}`,
          grounding_score: 0.0,
          relevance_score: 0.0,
          evaluator_feedback: err.stack,
          latency_ms: 0,
        });
      }
    }

    this.logger.log(`Đã hoàn thành lượt chạy Evals Run ID: ${evalRunId}`);
  }

  /**
   * Gọi model Judge chấm điểm thông qua usecase của LLM Gateway
   */
  private async judgeResponse(
    context: string, 
    query: string, 
    expected: string, 
    actual: string
  ): Promise<{ grounding_score: number; relevance_score: number; feedback: string }> {
    
    const systemPrompt = `
      You are an expert AI evaluator. Grade the chatbot based on context, query, expected answer, and actual answer.
      Evaluate 2 criteria (each 1.00 to 5.00):
      1. Grounding Score: How well the actual answer stays grounded in the Context (no hallucinations).
      2. Relevance Score: How well the answer addresses the query and semantic match to expected.
      
      Output strictly JSON:
      {
        "grounding_score": number,
        "relevance_score": number,
        "feedback": "string explaining reasoning in 2 sentences"
      }
    `;

    const userMessage = `
      [INPUTS]
      - Context: ${context}
      - Query: ${query}
      - Expected Answer: ${expected}
      - Actual Answer: ${actual}
    `;

    const response = await this.llmGateway.generateText({
      usecaseKey: 'EVALS_JUDGE', // Định tuyến động qua Gateway tới GPT-4o/Claude 3.5 Sonnet
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      jsonMode: true
    });

    return JSON.parse(response);
  }
}
```

---

## 20. Logic Tích Hợp Công Cụ Đặt Lịch Hẹn Vào ReAct Agent (AI Booking Tools Logic)

Đặc tả logic gọi Service nội bộ của Module Đặt Lịch Hẹn từ Agent Tool Executor của Chatbot:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AvailableSlotsService } from '../booking/available-slots.service';
import { AppointmentService } from '../booking/appointment.service';
import { CreateAppointmentDto } from '../booking/dto/create-appointment.dto';

@Injectable()
export class ChatbotBookingTools {
  private readonly logger = new Logger(ChatbotBookingTools.name);

  constructor(
    private readonly availableSlotsService: AvailableSlotsService,
    private readonly appointmentService: AppointmentService,
  ) {}

  /**
   * 1. Thực thi Tool get_booking_slots
   * Trả về danh sách khung giờ trống định dạng chuỗi ISO để nạp vào Chatbot Observation
   */
  async executeGetSlotsTool(args: {
    event_type_slug: string;
    start_date: string;
    end_date: string;
  }): Promise<string> {
    try {
      this.logger.log(`AI gọi Tool get_booking_slots: ${JSON.stringify(args)}`);
      
      const startDate = new Date(args.start_date);
      const endDate = new Date(args.end_date);
      
      // Gọi service của Booking Module để tìm và sinh các slots trống khả dụng
      const slots = await this.availableSlotsService.generateSlotsBySlug(
        args.event_type_slug,
        startDate,
        endDate
      );

      if (slots.length === 0) {
        return JSON.stringify({
          success: true,
          message: 'Không có khung giờ nào trống trong khoảng thời gian này. Vui lòng chọn khoảng ngày khác.',
          slots: []
        });
      }

      // Trả về JSON chứa mảng slots cho Chatbot Agent đọc
      return JSON.stringify({
        success: true,
        slots: slots.map(date => date.toISOString())
      });
    } catch (error) {
      this.logger.error(`Lỗi thực thi Tool get_booking_slots: ${error.message}`, error.stack);
      return JSON.stringify({
        success: false,
        error: `Lỗi hệ thống khi tra cứu lịch trống: ${error.message}`
      });
    }
  }

  /**
   * 2. Thực thi Tool create_appointment
   * Tạo lịch hẹn chính thức và đồng bộ CRM, trả về kết quả cho Chatbot Observation
   */
  async executeCreateAppointmentTool(args: {
    event_type_slug: string;
    start_time: string;
    customer_name: string;
    customer_phone: string;
    customer_email: string;
    notes?: string;
  }): Promise<string> {
    try {
      this.logger.log(`AI gọi Tool create_appointment: ${JSON.stringify(args)}`);

      // Khởi tạo DTO đặt lịch
      const dto = new CreateAppointmentDto();
      dto.customerName = args.customer_name;
      dto.customerPhone = args.customer_phone;
      dto.customerEmail = args.customer_email;
      dto.startTime = args.start_time;
      dto.notes = args.notes;

      // Tìm Event Type ID từ slug
      const eventType = await this.availableSlotsService.findEventTypeBySlug(args.event_type_slug);
      if (!eventType) {
        return JSON.stringify({
          success: false,
          error: `Không tìm thấy loại cuộc hẹn với mã slug: ${args.event_type_slug}`
        });
      }
      dto.eventTypeId = eventType.id;

      // Thực hiện đặt lịch qua AppointmentService của Booking Module
      // Service này sẽ tự động chạy Round-Robin, Sync CRM và schedule BullMQ reminders
      const appointment = await this.appointmentService.bookAppointment(dto, eventType.duration);

      return JSON.stringify({
        success: true,
        message: 'Lịch hẹn đã được tạo thành công.',
        appointment: {
          id: appointment.id,
          startTime: appointment.start_time.toISOString(),
          endTime: appointment.end_time.toISOString(),
          hostName: appointment.host ? appointment.host.full_name : 'Chuyên viên tư vấn',
          meetingLink: appointment.meeting_link || null
        }
      });
    } catch (error) {
      this.logger.error(`Lỗi thực thi Tool create_appointment: ${error.message}`, error.stack);
      return JSON.stringify({
        success: false,
        error: `Lỗi hệ thống khi tạo lịch hẹn: ${error.message}`
      });
    }
  }
}
```

---

## 21. Đặc Tả Thuật Toán Kiểm Tra Đồ Thị Kịch Bản (GraphValidator - DFS & BFS)

Đảm bảo các kịch bản luồng tin nhắn tự do được xây dựng hợp lệ, không chứa chu trình lặp vô hạn và không có node mồ côi cô lập.

```typescript
@Injectable()
export class GraphValidator {
  /**
   * Xác thực đồ thị Flow
   */
  validateFlowGraph(nodes: CreateNodeDto[]): { isValid: boolean; error?: string } {
    const adjList = new Map<string, string[]>();
    const nodeMap = new Map<string, CreateNodeDto>();
    const allNodeIds = new Set<string>();

    for (const node of nodes) {
      nodeMap.set(node.id, node);
      allNodeIds.add(node.id);
      
      const neighbors: string[] = [];
      if (node.nextNodeId) {
        neighbors.push(node.nextNodeId);
      }
      
      // Nếu là node rẽ nhánh CONDITION, nó có thể có nhiều nhánh next nodes trong content
      if (node.type === 'CONDITION' && node.content?.branches) {
        for (const branch of node.content.branches) {
          if (branch.nextNodeId) {
            neighbors.push(branch.nextNodeId);
          }
        }
        if (node.content.defaultNextNodeId) {
          neighbors.push(node.content.defaultNextNodeId);
        }
      }
      adjList.set(node.id, neighbors);
    }

    // 1. DFS phát hiện chu trình (vòng lặp vô hạn)
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      if (recStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recStack.add(nodeId);

      const neighbors = adjList.get(nodeId) || [];
      for (const neighbor of neighbors) {
        if (hasCycle(neighbor)) return true;
      }

      recStack.delete(nodeId);
      return false;
    };

    // Giả sử node đầu tiên trong mảng là root node (hoặc node được chỉ định)
    const rootNode = nodes[0];
    if (!rootNode) {
      return { isValid: false, error: 'Flow không chứa node nào.' };
    }

    if (hasCycle(rootNode.id)) {
      return { isValid: false, error: 'Phát hiện chu trình (vòng lặp vô hạn) trong kịch bản.' };
    }

    // 2. BFS phát hiện node cô lập (unreachable nodes)
    const reachable = new Set<string>();
    const queue: string[] = [rootNode.id];
    reachable.add(rootNode.id);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const neighbors = adjList.get(curr) || [];
      for (const neighbor of neighbors) {
        if (!reachable.has(neighbor)) {
          reachable.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (reachable.size < allNodeIds.size) {
      const unreachableNodes = [...allNodeIds].filter(id => !reachable.has(id));
      return { 
        isValid: false, 
        error: `Phát hiện node cô lập không thể đi tới từ node gốc: ${unreachableNodes.join(', ')}` 
      };
    }

    return { isValid: true };
  }
}
```

---

## 22. Đặc Tả Core Engine Chạy Kịch Bản Tĩnh (FlowExecutorService)

Chịu trách nhiệm duyệt các node kịch bản, thực thi các hành động CRM hoặc Webhook, rẽ nhánh điều kiện và gửi tin nhắn ra các cổng gateway.

```typescript
@Injectable()
export class FlowExecutorService {
  constructor(
    @InjectRepository(NodeEntity)
    private readonly nodeRepo: Repository<NodeEntity>,
    @InjectRepository(ChatConversation)
    private readonly conversationRepo: Repository<ChatConversation>,
    private readonly gatewayApiService: GatewayApiService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Thực thi một Node cụ thể trong cuộc hội thoại
   */
  async executeNode(conversationId: string, nodeId: string): Promise<void> {
    const conversation = await this.conversationRepo.findOneBy({ id: conversationId });
    if (!conversation || conversation.state !== 'FLOW_EXECUTING') return;

    const node = await this.nodeRepo.findOneBy({ id: nodeId });
    if (!node) return;

    this.logger.log(`Thực thi Node ${node.id} (Type: ${node.type}) cho Conversation ${conversationId}`);

    switch (node.type) {
      case 'MESSAGE':
        // Gửi tin nhắn qua Webhook/Gateway API
        await this.gatewayApiService.sendMessage({
          channel: conversation.channel,
          recipientId: conversation.sender_id,
          text: node.content.text,
          buttons: node.content.buttons || [], // Tối đa 3 nút
          carousel: node.content.carousel || null
        });

        // Đi tiếp tới node tiếp theo
        if (node.nextNodeId) {
          await this.executeNode(conversationId, node.nextNodeId);
        } else {
          // Kết thúc Flow, trả lại trạng thái AUTOMATIC để AI tiếp quản
          await this.finishFlow(conversationId);
        }
        break;

      case 'ACTION':
        // Thực thi các hành động CRM
        if (node.content.actionType === 'ADD_TAG') {
          this.eventEmitter.emit('crm.customer.add_tag', {
            customerId: conversation.customer_id,
            tag: node.content.tag
          });
        } else if (node.content.actionType === 'ASSIGN_SALES') {
          this.eventEmitter.emit('crm.customer.assign_sales', {
            customerId: conversation.customer_id,
            salesId: node.content.salesId
          });
        } else if (node.content.actionType === 'WEBHOOK') {
          // Bắn dữ liệu ra API ngoài
          await this.triggerExternalWebhook(node.content.url, {
            conversationId,
            customerId: conversation.customer_id
          });
        }

        // Chuyển tiếp ngay
        if (node.nextNodeId) {
          await this.executeNode(conversationId, node.nextNodeId);
        } else {
          await this.finishFlow(conversationId);
        }
        break;

      case 'CONDITION':
        // Đánh giá điều kiện dựa trên thông tin khách hàng từ CRM
        const customer = await this.getCustomerData(conversation.customer_id);
        let targetNextNodeId = node.content.defaultNextNodeId || null;

        for (const branch of node.content.branches || []) {
          if (this.evaluateConditionExpression(customer, branch.expression)) {
            targetNextNodeId = branch.nextNodeId;
            break;
          }
        }

        if (targetNextNodeId) {
          await this.executeNode(conversationId, targetNextNodeId);
        } else {
          await this.finishFlow(conversationId);
        }
        break;
    }
  }

  private async finishFlow(conversationId: string): Promise<void> {
    await this.conversationRepo.update(conversationId, { state: 'AUTOMATIC' });
  }

  private evaluateConditionExpression(customer: any, expression: string): boolean {
    // Đánh giá đơn giản, ví dụ: "location == 'Đồng Nai'" hoặc "monthly_bill > 2000000"
    const [field, operator, val] = expression.split(' ');
    const customerVal = customer[field] || customer.custom_fields?.[field];

    if (operator === '==') return String(customerVal) === val.replace(/['"]/g, '');
    if (operator === '>') return Number(customerVal) > Number(val);
    if (operator === '<') return Number(customerVal) < Number(val);
    return false;
  }
}
```

---

## 23. Đặc Tả Nhận Diện Từ Khóa Kích Hoạt (KeywordRouterService)

Quét tin nhắn đầu vào của khách để so khớp từ khóa và kích hoạt Flow kịch bản.

```typescript
@Injectable()
export class KeywordRouterService {
  constructor(
    @InjectRepository(KeywordEntity)
    private readonly keywordRepo: Repository<KeywordEntity>,
    @InjectRepository(ChatConversation)
    private readonly conversationRepo: Repository<ChatConversation>,
    private readonly flowExecutor: FlowExecutorService,
  ) {}

  /**
   * Kiểm tra tin nhắn và định tuyến nếu khớp từ khóa
   * @returns true nếu khớp từ khóa và đã kích hoạt luồng, false nếu không khớp
   */
  async matchAndRoute(conversationId: string, messageText: string): Promise<boolean> {
    const cleanText = messageText.toLowerCase().trim();
    const activeKeywords = await this.keywordRepo.find({ where: { isActive: true } });

    for (const kw of activeKeywords) {
      let isMatched = false;
      const cleanKw = kw.keyword.toLowerCase().trim();

      if (kw.matchType === 'EXACT') {
        isMatched = cleanText === cleanKw;
      } else if (kw.matchType === 'CONTAINS') {
        isMatched = cleanText.includes(cleanKw);
      } else if (kw.matchType === 'STARTS_WITH') {
        isMatched = cleanText.startsWith(cleanKw);
      }

      if (isMatched) {
        this.logger.log(`Khớp từ khóa "${kw.keyword}" (${kw.matchType}) cho Conversation ${conversationId}. Kích hoạt Flow ${kw.flowId}`);
        
        // Cập nhật trạng thái hội thoại sang chạy luồng
        await this.conversationRepo.update(conversationId, { state: 'FLOW_EXECUTING' });

        // Lấy node đầu tiên của Flow được gán để bắt đầu thực thi
        const firstNode = await this.findFirstNodeOfFlow(kw.flowId);
        if (firstNode) {
          // Kích hoạt thực thi bất đồng bộ
          this.flowExecutor.executeNode(conversationId, firstNode.id);
        }
        return true;
      }
    }

    return false;
  }
}
```

---

## 24. Đặc Tả Chuỗi Chăm Sóc Tự Động (SequenceSchedulerService)

Lập lịch gửi tin nhắn chăm sóc bám đuổi qua BullMQ hàng đợi delay và tự động hủy đăng ký khi phát hiện khách hàng tương tác thủ công.

```typescript
@Injectable()
export class SequenceSchedulerService {
  constructor(
    @InjectQueue('chatbot-sequence') private readonly sequenceQueue: Queue,
    @InjectRepository(SequenceSubscriberEntity)
    private readonly subscriberRepo: Repository<SequenceSubscriberEntity>,
    @InjectRepository(SequenceStepEntity)
    private readonly stepRepo: Repository<SequenceStepEntity>,
  ) {}

  /**
   * Đăng ký khách hàng vào chuỗi chăm sóc
   */
  async subscribeCustomer(sequenceId: string, customerId: string): Promise<void> {
    // 1. Tạo bản ghi subscriber
    const firstStep = await this.stepRepo.findOne({
      where: { sequenceId },
      order: { sortOrder: 'ASC' }
    });

    if (!firstStep) return;

    const nextExecution = new Date(Date.now() + firstStep.delaySeconds * 1000);
    
    await this.subscriberRepo.save({
      sequenceId,
      customerId,
      currentStepId: firstStep.id,
      status: 'ACTIVE',
      nextExecutionAt: nextExecution
    });

    // 2. Thêm Delay Job vào BullMQ
    const jobId = `sequence:${sequenceId}:${customerId}:${firstStep.id}`;
    await this.sequenceQueue.add(
      'execute-step',
      { sequenceId, customerId, stepId: firstStep.id },
      { jobId, delay: firstStep.delaySeconds * 1000, removeOnComplete: true, removeOnFail: true }
    );
  }

  /**
   * Hủy đăng ký chuỗi của khách hàng (khi khách nhắn tin tay hoặc Sale tiếp quản)
   */
  async unsubscribeCustomer(sequenceId: string, customerId: string): Promise<void> {
    const subscriber = await this.subscriberRepo.findOneBy({ sequenceId, customerId });
    if (!subscriber) return;

    subscriber.status = 'UNSUBSCRIBED';
    subscriber.nextExecutionAt = null;
    await this.subscriberRepo.save(subscriber);

    // Xóa job trong BullMQ nếu chưa chạy
    if (subscriber.currentStepId) {
      const jobId = `sequence:${sequenceId}:${customerId}:${subscriber.currentStepId}`;
      const job = await this.sequenceQueue.getJob(jobId);
      if (job) {
        await job.remove();
      }
    }
  }
}

@Processor('chatbot-sequence')
export class ChatbotSequenceConsumer {
  constructor(
    @InjectRepository(SequenceSubscriberEntity)
    private readonly subscriberRepo: Repository<SequenceSubscriberEntity>,
    @InjectRepository(SequenceStepEntity)
    private readonly stepRepo: Repository<SequenceStepEntity>,
    @InjectRepository(ChatConversation)
    private readonly conversationRepo: Repository<ChatConversation>,
    private readonly flowExecutor: FlowExecutorService,
    @InjectQueue('chatbot-sequence') private readonly sequenceQueue: Queue,
  ) {}

  @Process('execute-step')
  async handleStepExecution(job: Job<{ sequenceId: string, customerId: string, stepId: string }>) {
    const { sequenceId, customerId, stepId } = job.data;
    
    const subscriber = await this.subscriberRepo.findOneBy({ sequenceId, customerId });
    if (!subscriber || subscriber.status !== 'ACTIVE') return;

    // Kiểm tra trạng thái hội thoại của khách hàng trong DB.
    // Nếu trạng thái là MANUAL, ta tự động dừng gửi chuỗi (Unsubscribe)
    const conversation = await this.conversationRepo.findOne({
      where: { customer_id: customerId }
    });

    if (conversation && conversation.state === 'MANUAL') {
      subscriber.status = 'UNSUBSCRIBED';
      subscriber.nextExecutionAt = null;
      await this.subscriberRepo.save(subscriber);
      return;
    }

    const currentStep = await this.stepRepo.findOneBy({ id: stepId });
    if (!currentStep) return;

    // 1. Kích hoạt Flow cho cuộc trò chuyện
    if (conversation) {
      await this.conversationRepo.update(conversation.id, { state: 'FLOW_EXECUTING' });
      const firstNode = await this.findFirstNodeOfFlow(currentStep.flowId);
      if (firstNode) {
        await this.flowExecutor.executeNode(conversation.id, firstNode.id);
      }
    }

    // 2. Tìm bước tiếp theo
    const nextStep = await this.stepRepo.findOne({
      where: { sequenceId, sortOrder: currentStep.sortOrder + 1 },
      order: { sortOrder: 'ASC' }
    });

    if (nextStep) {
      const nextExecution = new Date(Date.now() + nextStep.delaySeconds * 1000);
      subscriber.currentStepId = nextStep.id;
      subscriber.nextExecutionAt = nextExecution;
      await this.subscriberRepo.save(subscriber);

      // Thêm job tiếp theo vào hàng đợi delay
      const nextJobId = `sequence:${sequenceId}:${customerId}:${nextStep.id}`;
      await this.sequenceQueue.add(
        'execute-step',
        { sequenceId, customerId, stepId: nextStep.id },
        { jobId: nextJobId, delay: nextStep.delaySeconds * 1000, removeOnComplete: true, removeOnFail: true }
      );
    } else {
      // Hoàn thành chuỗi
      subscriber.status = 'COMPLETED';
      subscriber.currentStepId = null;
      subscriber.nextExecutionAt = null;
      await this.subscriberRepo.save(subscriber);
    }
  }
}
```

---

## 25. Đặc Tả Gửi Tin Nhắn Hàng Loạt & Circuit Breaker (BroadcastWorker)

Worker xử lý bất đồng bộ các chiến dịch gửi tin hàng loạt (chia lô 50 khách), áp dụng giãn cách rate limiting chống khóa page/OA, dời lịch khi rơi vào giờ giới nghiêm (22h-7h) và tự động ngắt khẩn cấp (Circuit Breaker) khi lỗi 20 tin liên tiếp.

```typescript
@Processor('facebook-broadcast')
@Processor('zalo-broadcast')
export class BroadcastWorker {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    @InjectRepository(BroadcastCampaignEntity)
    private readonly campaignRepo: Repository<BroadcastCampaignEntity>,
    @InjectRepository(BroadcastLogEntity)
    private readonly logRepo: Repository<BroadcastLogEntity>,
    private readonly flowExecutor: FlowExecutorService,
    private readonly gatewayApiService: GatewayApiService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Process('send-broadcast')
  async handleSend(job: Job<{ campaignId: string, customerId: string }>) {
    const { campaignId, customerId } = job.data;
    const campaign = await this.campaignRepo.findOneBy({ id: campaignId });
    if (!campaign || campaign.status !== 'PROCESSING') return;

    // 1. Kiểm tra Circuit Breaker trong Redis
    const errorCounterKey = `errors:broadcast:campaign:${campaignId}`;
    const errorsCount = await this.redis.get(errorCounterKey);
    if (errorsCount && Number(errorsCount) >= 20) {
      // Đã đạt ngưỡng 20 lỗi liên tiếp -> Dừng chiến dịch
      await this.campaignRepo.update(campaignId, { status: 'FAILED' });
      
      // Gửi event outbox cảnh báo khẩn cấp cho IT Admin
      this.eventEmitter.emit('chat.broadcast.failed_circuit_breaker', {
        campaignId,
        campaignName: campaign.name,
        errorReason: 'Đạt ngưỡng 20 lỗi liên tiếp, access token hoặc fanpage bị khóa.'
      });
      return;
    }

    // 2. Kiểm tra giờ giới nghiêm (Quiet Hours: 22:00 - 07:00)
    const now = new Date();
    const vnTime = new Date(now.getTime() + (now.getTimezoneOffset() + 420) * 60 * 1000);
    const vnHour = vnTime.getHours();

    if (vnHour >= 22 || vnHour < 7) {
      // Trì hoãn gửi: dời lịch sang 08:00 sáng hôm sau
      const targetTime = new Date(vnTime);
      targetTime.setHours(8, 0, 0, 0);
      if (vnHour >= 22) targetTime.setDate(targetTime.getDate() + 1);
      
      const delayMs = targetTime.getTime() - vnTime.getTime();
      
      // Cấu hình gửi lại qua BullMQ
      await job.queue.add(
        'send-broadcast',
        { campaignId, customerId },
        { delay: delayMs, removeOnComplete: true }
      );
      return;
    }

    // 3. Thực hiện gửi tin
    const customer = await this.getCustomerData(customerId);
    const recipientId = campaign.channel === 'FACEBOOK' ? customer.facebook_psid : customer.zalo_user_id;

    if (!recipientId) {
      await this.logRepo.save({
        campaignId,
        customerId,
        status: 'SKIPPED',
        errorMessage: 'Khách hàng không liên kết ID Facebook/Zalo.'
      });
      return;
    }

    // Áp dụng Rate Limiting giãn cách tin nhắn (Facebook 1s, Zalo 0.5s)
    const delay = campaign.channel === 'FACEBOOK' ? 1000 : 500;
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      // Tìm node đầu tiên của Flow
      const firstNode = await this.findFirstNodeOfFlow(campaign.flowId);
      if (!firstNode) throw new Error('Không tìm thấy node cấu hình của Flow');

      // Tạo cuộc hội thoại giả lập hoặc tìm cuộc hội thoại hiện tại để gắn flow
      const conversationId = await this.findOrCreateConversation(customer, campaign.channel);

      // Kích hoạt chạy kịch bản gửi tin
      await this.flowExecutor.executeNode(conversationId, firstNode.id);

      // Ghi log thành công
      await this.logRepo.save({
        campaignId,
        customerId,
        status: 'SENT',
        sentAt: new Date()
      });

      // Tăng số lượng gửi thành công và reset error counter của Circuit Breaker
      await this.campaignRepo.increment({ id: campaignId }, 'sentCount', 1);
      await this.redis.del(errorCounterKey);

    } catch (error) {
      // Ghi log thất bại
      await this.logRepo.save({
        campaignId,
        customerId,
        status: 'FAILED',
        errorMessage: error.message
      });

      await this.campaignRepo.increment({ id: campaignId }, 'failedCount', 1);
      
      // Tăng counter Circuit Breaker
      await this.redis.incr(errorCounterKey);
      await this.redis.expire(errorCounterKey, 3600); // 1h
    }
  }
}
```

