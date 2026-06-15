# Task Lập Trình Module Gateway

- `[ ]` **Fastify Setup:** Cấu hình NestJS để chạy trên nền Fastify.
- `[ ]` **Channel Configuration:** Viết API quản lý thông số kết nối FB/Zalo, lưu vào DB `gw_channel_configurations`.
- `[ ]` **Signature Middleware:** Viết Guard/Middleware verify chữ ký Facebook HMAC-SHA256.
- `[ ]` **Zalo Middleware:** Viết Guard/Middleware verify chữ ký Zalo OA.
- `[ ]` **Parser & Mapper:** Viết logic transform các format JSON dị biệt của FB/Zalo về chuẩn `UnifiedMessage` interface.
- `[ ]` **Redis BullMQ Integration:** Setup cấu hình kết nối Redis.
- `[ ]` **Producer implementation:** Đẩy `UnifiedMessage` vào Queue và test độ trễ phản hồi HTTP 200.
