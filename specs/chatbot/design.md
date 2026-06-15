# Thiết Kế Kiến Trúc Module Chatbot (Design)

## 1. Mẫu Thiết Kế (Design Patterns)
- **LLM Gateway (Router):** Sử dụng kiến trúc định tuyến (như LiteLLM) để quản lý Multi-Provider, Load Balancing và Failover an toàn giữa các mô hình AI.
- **Adapter Pattern / Factory Pattern**: Quản lý nhiều LLM Provider (OpenAI, Gemini) thông qua Interface `BaseLLMAdapter` trong backend NestJS.
- **Registry Pattern**: Lazy Loading khởi tạo các adapter (AI Models) để tối ưu RAM. Chỉ Model nào đang hoạt động mới được load vào bộ nhớ.

## 2. Thiết Kế Database (Lược Đồ Quan Hệ)

### 2.1. Bảng `chat_conversations` (Phiên Chat)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | Định danh phiên chat |
| `channel` | VARCHAR(50) | Kênh chat (`FACEBOOK`, `ZALO`) |
| `sender_id` | VARCHAR(255) | ID khách hàng trên MXH (PSID, Zalo User ID) |
| `state` | VARCHAR(50) | `AUTOMATIC` (AI trả lời) / `MANUAL` (Người trả lời) |
| `assignee_id` | UUID | Nhân viên tiếp quản (nếu có, soft link sang `iam_users`) |
| `last_message_at` | TIMESTAMP | Thời điểm tin nhắn cuối cùng được gửi (bất kỳ ai gửi) |
| `last_customer_message_at` | TIMESTAMP | Thời điểm tin nhắn cuối cùng của khách hàng |
| `followup_status` | VARCHAR(20) | Trạng thái nhắc nhở (`PENDING`, `SENT`, `SKIPPED`) |
| `created_at` | TIMESTAMP | Thời gian tạo |

### 2.2. Bảng `chat_messages` (Tin Nhắn)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | Định danh tin |
| `conversation_id`| UUID (FK)| Thuộc phiên chat nào, cascade delete |
| `sender_type` | VARCHAR(50) | `CUSTOMER`, `AI`, `HUMAN_AGENT` |
| `content` | TEXT | Nội dung tin nhắn |
| `created_at` | TIMESTAMP | Thời gian nhắn |

### 2.3. Bảng `rag_documents` (Tài liệu kiến thức Solar - Phân cấp)
Hỗ trợ kiến trúc **Hierarchical Chunking** qua trường tự liên kết `parent_id` và tìm kiếm FTS tối ưu hóa qua cột sinh `tsv_content`.
| Tên Trường | Kiểu Dữ Liệu | Thuộc tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID (PK) | NOT NULL | Định danh chunk |
| `parent_id` | UUID (FK) | NULLABLE | Trỏ về chunk cha (nếu có), trỏ về `rag_documents.id` |
| `chunk_type` | VARCHAR(20) | NOT NULL | Phân loại chunk: `DOCUMENT` (gốc), `PARENT` (lớn), `CHILD` (nhỏ) |
| `title` | VARCHAR(255) | | Tên tài liệu hoặc link nguồn |
| `content_chunk` | TEXT | NOT NULL | Nội dung text của chunk |
| `tsv_content` | TSVECTOR | GENERATED | Generated `to_tsvector('simple', content_chunk)` stored |
| `embedding` | VECTOR(1536) | NULLABLE | Vector nhúng (chỉ bắt buộc trên `CHILD` chunk để tìm kiếm, độ dài linh hoạt 1536 hoặc 768 tùy model) |
| `created_at` | TIMESTAMP | Default NOW() | Thời gian tạo |

*Đánh chỉ mục (Index):*
- Cột `embedding` đánh index loại `HNSW` với hàm khoảng cách `cosine` để tìm kiếm ngữ nghĩa siêu tốc (chỉ index các bản ghi `CHILD` chunk).
- Cột `tsv_content` đánh index loại `GIN` hỗ trợ Full-Text Search (FTS) tiếng Việt hiệu năng cao.

### 2.4. Bảng `gw_llm_providers` (Danh sách API Keys của hãng LLM)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Định danh cấu hình |
| `name` | VARCHAR(100) | NOT NULL | Tên gợi nhớ (VD: "OpenAI Chính") |
| `provider_type` | VARCHAR(50) | NOT NULL | Hãng (`openai`, `gemini`, `anthropic`, `deepseek`, `ollama`) |
| `api_key` | TEXT | NOT NULL | API Key (mã hóa AES-256) |
| `api_base` | VARCHAR(255) | | URL custom endpoint (nếu có) |
| `priority` | INTEGER | NOT NULL | Độ ưu tiên (1 là cao nhất) |
| `status` | VARCHAR(30) | Default 'ACTIVE' | `ACTIVE`, `OUT_OF_CREDIT`, `INACTIVE` |

### 2.5. Bảng `gw_llm_provider_models` (Chi tiết các Model đồng bộ từ LiteLLM)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Định danh model |
| `provider_id` | UUID | FOREIGN KEY | Trỏ đến `gw_llm_providers.id` (Cascade) |
| `model_name` | VARCHAR(100) | NOT NULL | Tên model kỹ thuật (ví dụ: `gpt-4o-mini`) |
| `model_tier` | VARCHAR(20) | NOT NULL | Phân lớp (`LARGE` hoặc `SMALL`) |
| `max_tokens` | INTEGER | | Context Window |
| `max_input_tokens` | INTEGER | | Token đầu vào tối đa |
| `max_output_tokens`| INTEGER | | Token đầu ra tối đa |
| `input_cost_per_token`| NUMERIC(15, 12)| | Giá token đầu vào (USD) |
| `output_cost_per_token`| NUMERIC(15, 12)| | Giá token đầu ra (USD) |
| `is_active` | BOOLEAN | Default TRUE | |
| `raw_metadata` | JSONB | Default '{}' | JSON thô trả về từ LiteLLM |

*Ràng buộc:* `UNIQUE(provider_id, model_name)`.

### 2.6. Bảng `gw_llm_usecases` (Cấu hình Model cho tính năng AI)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Định danh cấu hình |
| `usecase_key` | VARCHAR(50) | UNIQUE, NOT NULL | Khóa kịch bản (`AGENT_CHAT`, `QUERY_REWRITE`, `CONVERSATION_SUMMARY`...) |
| `usecase_name` | VARCHAR(100) | NOT NULL | Tên kịch bản |
| `required_tier` | VARCHAR(20) | NOT NULL | Phân lớp khuyến nghị (`LARGE` / `SMALL`) |
| `provider_model_id`| UUID | FOREIGN KEY | Chỉ định Model cứng. Nếu NULL thì tự động lấy theo Provider số 1 |

### 2.7. Bảng `gw_llm_metrics` (Nhật ký chi tiết các cuộc gọi và chi phí AI)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Định danh duy nhất |
| `conversation_id`| UUID | NULLABLE | Trỏ về phiên chat (nếu có, soft-link) |
| `usecase_key` | VARCHAR(50) | NOT NULL | Khóa kịch bản (`AGENT_CHAT`, `QUERY_REWRITE`...) |
| `provider_id` | UUID | FOREIGN KEY | Trỏ đến `gw_llm_providers.id` |
| `model_name` | VARCHAR(100) | NOT NULL | Tên model kỹ thuật thực tế sử dụng |
| `prompt_tokens` | INTEGER | NOT NULL | Số token đầu vào |
| `completion_tokens`| INTEGER | NOT NULL | Số token đầu ra |
| `cached_tokens` | INTEGER | NOT NULL | Số token đầu vào được lấy từ cache |
| `input_cost` | NUMERIC(15, 12)| NOT NULL | Chi phí token đầu vào (USD) |
| `output_cost` | NUMERIC(15, 12)| NOT NULL | Chi phí token đầu ra (USD) |
| `total_cost` | NUMERIC(15, 12)| NOT NULL | Tổng chi phí thực tế (USD) |
| `latency_ms` | INTEGER | | Thời gian xử lý API (Mili giây) |
| `created_at` | TIMESTAMP | Default NOW() | Thời điểm cuộc gọi |

## 3. Kiến Trúc RAG (Retrieval-Augmented Generation) & Thuật toán RRF
Hệ thống sử dụng kiến trúc tìm kiếm lai (Hybrid Search) kết hợp với thuật toán **Reciprocal Rank Fusion (RRF)**:

### 3.1. Phép toán RRF (Reciprocal Rank Fusion)
Khi người dùng đặt câu hỏi, hệ thống thực hiện đồng thời 2 câu truy vấn:
1. **Keyword Search (Sparse):** Thực hiện Full-Text Search trên trường `content_chunk` sử dụng `tsquery` của Postgres.
2. **Semantic Search (Dense):** Tính toán cosine similarity giữa Vector truy vấn và vector cột `embedding`.

Kết quả trả về từ cả hai câu truy vấn được xếp hạng (Rank). Điểm số RRF của mỗi tài liệu $d$ được tính theo công thức:
$$RRF\_Score(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$
*Trong đó:*
- $M$: Tập hợp các bộ truy xuất (ở đây gồm 2 bộ: Sparse và Dense).
- $r_m(d)$: Thứ hạng của tài liệu $d$ trong danh sách trả về của bộ truy xuất $m$ (bắt đầu từ 1). Nếu tài liệu không xuất hiện, $r_m(d) = \infty$ (đóng góp bằng 0).
- $k$: Hằng số làm mịn, mặc định là $60$.

Tài liệu có điểm $RRF\_Score$ cao nhất sẽ được chọn làm ngữ cảnh.

### 3.2. Luồng Hierarchical Chunking (Truy xuất phân cấp)
1. Khi có câu hỏi của người dùng, hệ thống chỉ so sánh vector truy vấn với các bản ghi có `chunk_type = 'CHILD'`.
2. Sau khi tìm được Top 3 Child Chunks có điểm số RRF cao nhất.
3. Hệ thống sẽ thực hiện truy vấn ngược lên theo `parent_id` để lấy nội dung của `PARENT` chunk tương ứng.
4. Đẩy nội dung `PARENT` chunk này làm Context đưa vào prompt của LLM. Kỹ thuật này giúp bảo toàn tính toàn vẹn thông tin (như bảng thông số kỹ thuật tấm pin), tránh việc LLM bị thiếu ngữ cảnh khi đọc một mẩu nhỏ rời rạc.

## 4. Kiến Trúc LLM Gateway Động (Dynamic Routing Proxy)
Hệ thống sử dụng LiteLLM Proxy làm stateless gateway. Việc quản lý API Key, điều phối và failover sẽ do Core Backend (NestJS) thực hiện động dựa trên dữ liệu trong Database.

### 4.1. Luồng Gửi Request Qua Gateway
NestJS sẽ gửi request HTTP POST tới LiteLLM endpoint `http://litellm-gateway:4000/v1/chat/completions` với các tham số:
- **Headers:**
  - `Authorization: Bearer <API_KEY>` (API Key lấy động từ bảng `gw_llm_providers` theo provider được chọn).
- **Body:**
  - `model`: Tên model định dạng `<provider_type>/<model_name>` (Ví dụ: `openai/gpt-4o-mini` hoặc `gemini/gemini-1.5-flash`).
  - `messages`: Mảng hội thoại.

### 4.2. API Endpoints Quản Lý Cấu Hình (Admin API)
- `GET /api/v1/gateway/providers`: Lấy danh sách provider và trạng thái.
- `POST /api/v1/gateway/providers`: Thêm mới cấu hình API Key và thiết lập priority.
- `PUT /api/v1/gateway/providers/:id`: Cập nhật API Key, priority hoặc trạng thái.
- `GET /api/v1/gateway/usecases`: Lấy danh sách cấu hình usecases hiện tại.
- `PATCH /api/v1/gateway/usecases/:id`: Cập nhật cấu hình chọn model (`provider_model_id`) cho kịch bản cụ thể.
- `POST /api/v1/gateway/models/sync`: API kích hoạt công việc (Sync Job) bằng tay để đồng bộ hóa danh sách Model, Context và chi phí từ LiteLLM Gateway `/public/litellm_model_cost_map`.
- **`GET /api/v1/gateway/metrics/summary`**: Thống kê tổng hợp chi phí AI theo thời gian (ngày/tuần/tháng), phân nhóm theo usecase, model hoặc provider để phục vụ vẽ chart Admin.
- **`GET /api/v1/gateway/metrics/raw`**: Lấy lịch sử chi tiết danh sách cuộc gọi AI (Hỗ trợ phân trang, lọc theo usecase, model, provider, conversation_id).

## 5. Thiết Kế Cơ Chế Dynamic Debounce & Khóa Đồng Thời (Redis & BullMQ)

Để gộp nhiều tin nhắn ngắn gửi liên tiếp của khách và tránh tình trạng double-texting gây race condition, hệ thống sử dụng kết hợp Redis List (làm buffer) và BullMQ (làm Delay Queue):

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Khách Hàng (Facebook/Zalo)
    participant Webhook as Webhook Controller (NestJS)
    participant Redis as Redis Buffer & Lock
    participant BullMQ as BullMQ Engine (Delay Queue)
    participant Consumer as Debounce Job Consumer
    participant Agent as ReAct Agent Service
    participant Guard as Guardrails & Grounding Service

    Customer->>Webhook: Gửi Tin 1 (Nội dung A)
    Webhook->>Redis: Đẩy Tin 1 vào RPUSH buffer:conversation:{id}
    Webhook->>BullMQ: Tạo/Ghi đè Delay Job "debounce:{id}" (Delay 10s)

    Customer->>Webhook: Gửi Tin 2 (Nội dung B, sau 3s)
    Webhook->>Redis: Đẩy Tin 2 vào RPUSH buffer:conversation:{id}
    Webhook->>BullMQ: Hủy Job cũ & Tạo Delay Job "debounce:{id}" mới (Delay 10s)

    Note over Webhook, BullMQ: Sau 10s tĩnh lặng kể từ Tin 2...
    BullMQ->>Consumer: Kích hoạt Job "debounce:{id}"
    Consumer->>Redis: Thử SET lock:conversation:{id} NX PX 30000
    alt Lấy Lock thành công
        Redis-->>Consumer: OK (Locked)
        Consumer->>Redis: Lấy & xóa toàn bộ tin nhắn: LRANGE + DEL buffer:conversation:{id}
        Redis-->>Consumer: Mảng [Tin 1, Tin 2]
        Consumer->>Consumer: Gộp Tin 1 + Tin 2 thành "A. B."
        Consumer->>Guard: Chạy Input Guardrails (Quét PII ẩn danh)
        Guard-->>Consumer: Nội dung an toàn (Redacted)
        
        %% Chạy OOD Filter
        Consumer->>OODFilter: checkAndFilterDomain(conversationId, RedactedQuery)
        alt Lọc xã giao tĩnh (General Greeting)
            OODFilter-->>Consumer: isInDomain = true (Bypass LLM)
        else Gọi Classifier & Query Rewriter
            OODFilter->>QueryRewriter: rewriteAndClassify(conversationId, RedactedQuery)
            QueryRewriter-->>OODFilter: { standalone_query, is_in_domain }
            alt is_in_domain = false (Lạc đề)
                OODFilter->>Customer: Gửi tin nhắn từ chối mẫu tĩnh
                OODFilter-->>Consumer: isInDomain = false (Dừng luồng)
            else is_in_domain = true (Hợp lệ)
                OODFilter-->>Consumer: isInDomain = true (standalone_query)
            end
        end

        alt Nếu isInDomain = true
            Consumer->>Agent: Gọi Agent xử lý standalone_query
            Agent-->>Consumer: Câu trả lời thô của AI
            Consumer->>Guard: Chạy Output Guardrails & Grounding Check (Chống ảo giác, sai giá)
            alt Đánh giá Đạt yêu cầu (FAITHFUL)
                Guard-->>Consumer: OK (Phản hồi an toàn)
                Consumer->>Customer: Gửi phản hồi chính thức
            else Phát hiện ảo giác / nội dung cấm (HALLUCINATED)
                Guard-->>Consumer: Báo lỗi ảo giác
                Consumer->>Agent: Gọi Agent sinh lại phản hồi (Retry tối đa 2 lần)
                Note over Consumer, Agent: Nếu vẫn lỗi, chuyển trạng thái MANUAL báo Sales
            end
        end
        Consumer->>Redis: Xóa khóa DEL lock:conversation:{id}
    else Lấy Lock thất bại
        Note over Consumer, Redis: Bỏ qua (Đang có Agent khác xử lý session này)
    end
```

### 5.1. Định nghĩa Redis Keys & Queue
- **Redis Message Buffer:** `buffer:conversation:<conversation_id>` (Kiểu: `List`, chứa payload tin nhắn của khách, TTL: `300` giây).
- **Redis Lock Key:** `lock:conversation:<conversation_id>` (Value: `"locked"`, TTL: `30000` ms).
- **BullMQ Queue Name:** `chatbot-debounce`
- **Job ID:** `debounce:<conversation_id>` (Dùng Job ID cố định để BullMQ dễ dàng tìm kiếm và cập nhật/hủy job cũ).

---

## 6. Thiết Kế Cơ Chế Tự Động Nhắc Nhở (Follow-up Scheduler & Quiet Hours)

Để tương tác lại với khách hàng sau 2 giờ im lặng mà không làm phiền giấc ngủ của họ, hệ thống tích hợp bộ lọc **Quiet Hours Guard** vào luồng lập lịch nhắc nhở:

```mermaid
sequenceDiagram
    autonumber
    participant Agent as ReAct Agent Service
    participant BullMQ as BullMQ Engine (Delay Queue)
    participant Webhook as Webhook Controller (NestJS)
    participant Consumer as Follow-up Job Consumer
    participant LLM as LiteLLM Gateway
    participant DB as PostgreSQL Database

    Agent->>Agent: Phản hồi tin nhắn cuối cho khách
    Agent->>BullMQ: Tạo Delay Job "followup:{id}" (Delay 2 giờ)

    alt Kịch bản 1: Khách hàng nhắn lại trước 2 giờ
        Webhook->>BullMQ: Hủy Delay Job "followup:{id}"
    else Kịch bản 2: Hết 2 giờ tĩnh lặng
        BullMQ->>Consumer: Kích hoạt Job "followup:{id}"
        Consumer->>DB: Query thông tin phiên chat (state, assignee_id, last_customer_message_at)
        alt Trạng thái AUTOMATIC (AI Chat)
            Consumer->>LLM: Gọi LLM sinh câu nhắc nhở tự nhiên theo ngữ cảnh
            LLM-->>Consumer: "Dạ, bên em không biết anh/chị..."
            Consumer->>Customer: Gửi tin nhắn tự động nhắc nhở
            Consumer->>DB: Cập nhật chat_conversations.followup_status = 'SENT'
        else Trạng thái MANUAL (Sales đang tiếp quản)
            Consumer->>DB: Bắn Event thông báo nhắc nhở cho Sales (assignee_id)
        end
    end
```

### 6.1. Chi tiết Job & Tham số
- **BullMQ Queue Name:** `chatbot-followup`
- **Job ID:** `followup:<conversation_id>`
- **Delay:** 2 giờ (`7200000` ms).
- **Cơ chế hủy Job:** Khi webhook nhận tin nhắn mới từ khách hàng, thực hiện:
  ```typescript
  const job = await this.followupQueue.getJob(`followup:${conversationId}`);
  if (job) {
    await job.remove();
  }
  ```

---

## 9. Thiết Kế Kiến Trúc Rào Chắn An Toàn (Guardrails & Hallucination Guard)

Để đảm bảo hệ thống vận hành an toàn trên môi trường Production, chatbot Solavie áp dụng kiến trúc rào chắn hai lớp (Lớp Lọc Regex & Lớp Kiểm Soát Độc Lập):

```
       [Webhook Tin Nhắn Khách]
                  │
                  ▼
      [Input PII Masking Guard] ──(Ẩn danh SĐT, Email, Số thẻ...)──> [ReAct Agent Service]
                                                                             │
                                                                             ▼
[Gửi Phản Hồi] <── [Output Guardrails & NLI Hallucination Validator] <── [Câu Trả Lời Thô]
                        │                    │
                        ├─(Quét Profanity)   ├─(Kiểm tra Grounding NLI)
                        ├─(Quét Error Codes) └─(So khớp bảng giá Solar)
                        └─(Chặn & Retry nếu lỗi)
```

### 9.1. Lớp Validator Interceptor ở NestJS
Hệ thống sử dụng các NestJS Interceptors chạy nền để bao bọc các cuộc gọi LLM Gateway:
- **`InputGuardrailInterceptor`**: Quét và che giấu thông tin nhạy cảm của khách trước khi truyền qua LLM Gateway.
- **`OutputGuardrailInterceptor`**: Đánh giá kết quả thô thu được từ LLM, nếu phát hiện lỗi hệ thống, từ cấm hoặc ảo giác về giá, sẽ chặn đứng phản hồi và ra lệnh cho Agent sinh lại (Retry Loop, tối đa 2 lần).

### 9.2. Cấu trúc CSDL Bảng Giá Cố Định (Price Configuration Reference)
Để phục vụ việc kiểm tra giá cả (Price Check) tự động ở đầu ra, hệ thống lưu trữ bảng giá Solar tham chiếu trong một biến cấu hình tĩnh (hoặc bảng chuyên dụng trong DB):
- Mảng cấu hình bảng giá dạng Key-Value hoặc JSON tĩnh (VD: `SOLAR_PRICE_MAP`), chứa các ngưỡng giá chính thức của Solavie tương ứng với từng hệ công suất (3kW, 5kW, 10kW...).
- Output Guardrail sẽ trích xuất các mẫu ký tự tiền tệ bằng Regex từ phản hồi của AI và so khớp sai số cho phép (+/- 5%) với bảng giá tham chiếu. Nếu sai số vượt quá, kích hoạt cảnh báo ảo giác.

---

## 10. Thiết Kế Bộ Lọc Ngoài Phạm Vi (Out-Of-Domain Filter Architecture)

Bộ lọc ngoài phạm vi (OOD Filter) hoạt động như một lớp cổng chặn (Gatekeeper) trước khi kích hoạt các xử lý nặng của Chatbot.

### 10.1. Cấu trúc lớp điều phối
Dịch vụ `ChatbotOodFilterService` tích hợp trực tiếp vào luồng xử lý tin nhắn của `ChatbotConsumer` (sau bước gộp tin nhắn Debounce và chạy Input Guardrails):

```
+-----------------------------------+
|          ChatbotConsumer          |
+-----------------+-----------------+
                  |
                  v
+-----------------+-----------------+
|     ChatbotOodFilterService       |
+--------+-----------------+--------+
         |                 |
         | (Greeting Match)| (Text query)
         v                 v
+--------+-------+ +-------+--------+
| ReAct Agent    | | QueryRewriter  |
| (Bypass LLM)   | | & Classifier   |
+----------------+ +-------+--------+
                           |
                           v
              { standalone_query, is_in_domain }
```

### 10.2. Các Regex và Từ khóa chào hỏi xã giao tĩnh (General Greetings)
Để tối ưu hóa chi phí API, hệ thống sử dụng một tập hợp Regex tĩnh để phát hiện nhanh các ý định chào hỏi hoặc yêu cầu chung không mang nội dung hỏi đáp kỹ thuật chuyên sâu:
- **Các từ khóa bắt đầu:** `alo`, `hi`, `hello`, `chào`, `chao ban`, `chào shop`, `ad ơi`, `admin ơi`
- **Mẫu biểu thức Regex chính:** `/^(alo|hi|hello|chào|chao ban|chào shop|ad ơi|admin ơi|chatbot)(\s|$)/i`
- Nếu khớp: Cho qua trực tiếp để ReAct Agent xử lý chào lại, không cần gọi RAG và không cần chạy qua LLM Classifier.

### 10.3. Phản hồi ngoài phạm vi mặc định (Out-of-Domain Response Template)
Nếu `is_in_domain = false`, hệ thống tự động trả về chuỗi phản hồi tĩnh cấu hình trong biến môi trường hoặc cấu hình hệ thống:
```text
Dạ, em là Trợ lý ảo chuyên tư vấn giải pháp Điện năng lượng mặt trời của Solavie. Hiện tại em chưa được đào tạo để trả lời các chủ đề ngoài lĩnh vực này. Anh/chị có câu hỏi nào về pin mặt trời, inverter hoặc chi phí lắp đặt cần em hỗ trợ không ạ?
```
Lịch sử tin nhắn từ chối tĩnh này sẽ được ghi vào cơ sở dữ liệu với `sender_type = 'AI'` để bảo toàn ngữ cảnh hội thoại.







