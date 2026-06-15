# Thiết Kế Kiến Trúc Module Gateway (Design)

## 1. Lựa Chọn Công Nghệ (Tech Stack)
- Sử dụng NestJS + Fastify Module. Fastify mang lại hiệu năng cao (throughput lớn) vượt trội so với Express, phù hợp xử lý hàng chục ngàn request/s.
- Redis Queue (BullMQ): Dùng làm Message Broker (Đệm tin nhắn).

## 2. Thiết Kế Database (Lược Đồ Quan Hệ)

### 2.1. Bảng `gw_channel_configurations` (Cấu Hình Webhook Kênh)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | |
| `channel_type` | VARCHAR(50) | `FACEBOOK`, `ZALO` |
| `credentials` | JSONB | Chứa App Secret, Page Token, OA Secret |

### 2.2. Bảng `gw_llm_models` (Quản Lý Model AI)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | |
| `provider` | VARCHAR(50) | Hãng (OpenAI, Gemini) |
| `model_name` | VARCHAR(100) | Tên model |
| `is_active` | BOOLEAN | |

## 3. Contract Chuẩn Hóa Tin Nhắn (UnifiedMessage)
Mọi tin nhắn gửi vào Redis Queue đều phải tuân theo cấu trúc DTO này:
```typescript
export interface UnifiedMessage {
  messageId: string;       // ID tin nhắn gốc
  channel: string;         // FACEBOOK hoặc ZALO
  senderId: string;        // ID người gửi (PSID)
  recipientId: string;     // ID trang nhận
  type: string;            // TEXT, IMAGE, DOCUMENT
  content: string;         // Nội dung
  timestamp: number;       // Thời gian (Unix epoch)
}
```
