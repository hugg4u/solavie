# Quy Chuẩn Ghi Log Module Chatbot & AI Core

Tất cả log từ Module Chatbot bắt buộc phải được ghi ở định dạng JSON có cấu trúc (stdout) để Promtail có thể trích xuất các nhãn đánh chỉ mục cho Grafana Loki.

## 1. Log Sử Dụng Token & Chi Phí (LLM Token Usage)
Mỗi cuộc gọi API thành công tới LLM Gateway đều phải ghi nhận lượng token tiêu thụ để phục vụ giám sát chi phí thời gian thực.
```json
{
  "timestamp": "2026-06-15T16:15:00.123Z",
  "level": "info",
  "module": "CHATBOT",
  "context": "LLM_API_CALL",
  "message": "LLM Call Success",
  "traceId": "t_react_982137_trace",
  "metadata": {
    "conversation_id": "conv_uuid_9921",
    "usecase_key": "AGENT_CHAT",
    "provider_id": "prov_openai_uuid_123",
    "model_name": "gpt-4o",
    "prompt_tokens": 1250,
    "completion_tokens": 320,
    "total_tokens": 1570,
    "cached_tokens": 1024,
    "input_cost": 0.00008475,
    "output_cost": 0.000192,
    "total_cost": 0.00027675,
    "latency_ms": 1150
  }
}
```

## 2. Log Từng Bước Suy Nghĩ Của Agent (ReAct Trace Log)
Ghi nhận quá trình suy luận (Reasoning) và gọi công cụ (Acting) của ReAct Agent. Mỗi lượt lặp (iteration) ghi 1 dòng log.
```json
{
  "timestamp": "2026-06-15T16:15:01.456Z",
  "level": "info",
  "module": "CHATBOT",
  "context": "REACT_AGENT_STEP",
  "message": "ReAct Step Execution",
  "traceId": "t_react_982137_trace",
  "metadata": {
    "iteration": 1,
    "thought": "Khách hàng muốn biết thời gian hoàn vốn của hệ thống 5kW. Tôi cần gọi Tool tính toán ROI.",
    "action": "calculate_solar_roi",
    "action_input": {
      "monthly_bill": 2500000,
      "roof_area": 40,
      "location": "Đồng Nai"
    },
    "observation": {
      "recommended_p": 4.5,
      "investment_vnd": 63000000,
      "payback_years": 4.8
    }
  }
}
```

## 3. Log Truy Xuất RAG (RAG Retrieval Metrics)
Ghi log kết quả truy xuất tài liệu, bao gồm cả kết quả viết lại câu hỏi (Query Rewriter) và kết quả gộp RRF.
```json
{
  "timestamp": "2026-06-15T16:15:00.678Z",
  "level": "info",
  "module": "CHATBOT",
  "context": "RAG_RETRIEVAL",
  "message": "RAG Documents Retrieved",
  "traceId": "t_react_982137_trace",
  "metadata": {
    "original_query": "bên mình bảo hành như nào vậy?",
    "rewritten_query": "chính sách bảo hành tấm pin Jinko Solar 550W là bao lâu?",
    "rrf_top_results": [
      {
        "id": "doc_child_uuid_1",
        "parent_id": "doc_parent_uuid_1",
        "title": "Chính sách bảo hành Jinko 2026",
        "rrf_score": 0.033,
        "dense_rank": 1,
        "sparse_rank": 2
      },
      {
        "id": "doc_child_uuid_5",
        "parent_id": "doc_parent_uuid_2",
        "title": "Tài liệu kỹ thuật Jinko 550W",
        "rrf_score": 0.016,
        "dense_rank": 3,
        "sparse_rank": 15
      }
    ]
  }
}
```

## 4. Log Rào Chắn Bảo Mật (PII Guardrails Event)
Ghi log khi phát hiện và che giấu các thông tin PII nhạy cảm. **Tuyệt đối không lưu vết nội dung nhạy cảm thô trong log.**
```json
{
  "timestamp": "2026-06-15T16:14:59.900Z",
  "level": "warn",
  "module": "CHATBOT",
  "context": "PII_GUARDRAILS",
  "message": "PII entity detected and redacted",
  "traceId": "t_react_982137_trace",
  "metadata": {
    "entities_found": [
      {
        "type": "PHONE_NUMBER",
        "index_start": 12,
        "index_end": 22
      }
    ],
    "redaction_method": "REGEX_MASKING"
  }
}
```

## 5. Log Cảnh Báo Lỗi & Failover (API Resilience)
Log lỗi API LLM hoặc kích hoạt failover. Log level `error` sẽ kích hoạt Alert tự động gửi Telegram.
```json
{
  "timestamp": "2026-06-15T16:15:05.111Z",
  "level": "error",
  "module": "CHATBOT",
  "context": "LLM_FAILOVER",
  "message": "Gateway primary model failed. Activating failover targeting gpt-4o-mini",
  "traceId": "t_react_982137_trace",
  "metadata": {
    "failed_provider": "gemini",
    "failed_model": "gemini-1.5-pro",
    "error_code": "HTTP_429",
    "error_message": "Resource has been exhausted (e.g. queries per minute)."
  }
}
```

## 6. Log Trạng Thái Tài Khoản Provider (Credit Status Change)
Ghi log khi hệ thống tự động cập nhật trạng thái của Provider vì hết tiền (OUT_OF_CREDIT).
```json
{
  "timestamp": "2026-06-15T16:15:05.222Z",
  "level": "warn",
  "module": "GATEWAY",
  "context": "PROVIDER_STATUS",
  "message": "Provider status updated to OUT_OF_CREDIT due to billing quota exhaust",
  "traceId": "t_react_982137_trace",
  "metadata": {
    "provider_id": "prov_openai_uuid_123",
    "provider_name": "OpenAI Main Account",
    "provider_type": "openai",
    "previous_status": "ACTIVE",
    "new_status": "OUT_OF_CREDIT"
  }
}
```

## 7. Log Chạy Job Đồng Bộ Model (Sync Models Job Log)
Ghi log thống kê số lượng model đã được đồng bộ từ LiteLLM Gateway vào Database của Solavie.
```json
{
  "timestamp": "2026-06-15T02:00:05.999Z",
  "level": "info",
  "module": "GATEWAY",
  "context": "MODELS_SYNC_JOB",
  "message": "LiteLLM Models sync job completed successfully",
  "traceId": "job_sync_models_20260615",
  "metadata": {
    "total_models_scraped": 125,
    "inserted_count": 8,
    "updated_count": 14,
    "skipped_count": 103,
    "active_providers_checked": ["openai", "gemini", "anthropic"]
  }
}
```


