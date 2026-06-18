# Thiết Kế Hạ Tầng Container (DevOps Design)

Dưới đây là đặc tả chi tiết thiết kế Dockerfile đa tầng (Multi-stage Build) và tệp điều phối dịch vụ Docker Compose hợp nhất phục vụ vận hành.

---

## 1. Thiết Kế Multi-Stage Dockerfile (Cho NestJS Backend)

Tối ưu dung lượng và bảo mật cho image chạy production:

```dockerfile
# ==========================================
# STAGE 1: Build & Compile TypeScript
# ==========================================
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

# Sao chép package configs
COPY package*.json ./
RUN npm ci

# Sao chép mã nguồn và compile
COPY . .
RUN npm run build

# ==========================================
# STAGE 2: Production Release
# ==========================================
FROM node:20-alpine AS runner
WORKDIR /usr/src/app

ENV NODE_ENV=production

# Chỉ cài dependencies phục vụ runtime
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Sao chép kết quả compile từ Stage builder
COPY --from=builder /usr/src/app/dist ./dist

# Sử dụng user phi-root (non-root) để tăng độ bảo mật
USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
```

---

## 2. Thiết Kế Docker Compose Hợp Nhất (`docker-compose.yml`)

Thiết lập toàn bộ tài nguyên môi trường phát triển trên một tệp duy nhất để các kỹ sư dễ dàng khởi động:

```yaml
version: '3.8'

services:
  # 1. Database PostgreSQL tích hợp PGVector
  postgres:
    image: ankane/pgvector:v0.5.1
    container_name: solavie-postgres
    environment:
      POSTGRES_DB: solavie_db
      POSTGRES_USER: solavie_admin
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U solavie_admin -d solavie_db"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: always

  # 2. Redis dành cho Caching & Typing Lock (Port 6379)
  redis-cache:
    image: redis:7-alpine
    container_name: solavie-redis-cache
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru --requirepass ${REDIS_CACHE_PASSWORD}
    ports:
      - "6379:6379"
    volumes:
      - redis_cache_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_CACHE_PASSWORD}", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: always

  # 3. Redis dành cho BullMQ Queue (Port 6380)
  redis-queue:
    image: redis:7-alpine
    container_name: solavie-redis-queue
    command: redis-server --maxmemory 1gb --maxmemory-policy noeviction --appendonly yes --requirepass ${REDIS_QUEUE_PASSWORD}
    ports:
      - "6380:6379" # Forward ra port 6380
    volumes:
      - redis_queue_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_QUEUE_PASSWORD}", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: always

  # 4. Object Storage MinIO (Port 9000 & Console 9001)
  minio:
    image: minio/minio:RELEASE.2024-06-10T16-36-28Z
    container_name: solavie-minio
    environment:
      MINIO_ROOT_USER: minio_admin
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    ports:
      - "9000:9000"
      - "9001:9001"
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: always

  # 5. AI LiteLLM Proxy (Port 4000)
  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    container_name: solavie-litellm
    ports:
      - "4000:4000"
    command: --port 4000
    restart: always

  # 6. NestJS Core Backend Application
  backend:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: solavie-backend
    environment:
      NODE_ENV: development
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: solavie_db
      DB_USER: solavie_admin
      DB_PASSWORD: ${DB_PASSWORD}
      REDIS_CACHE_URL: redis://:${REDIS_CACHE_PASSWORD}@redis-cache:6379/0
      REDIS_QUEUE_URL: redis://:${REDIS_QUEUE_PASSWORD}@redis-queue:6379/0 # Chạy cổng 6379 nội bộ mạng Docker
      MINIO_ENDPOINT: minio
      MINIO_PORT: 9000
      LITELLM_URL: http://litellm:4000
      GOOGLE_CALENDAR_CLIENT_ID: ${GOOGLE_CALENDAR_CLIENT_ID}
      GOOGLE_CALENDAR_CLIENT_SECRET: ${GOOGLE_CALENDAR_CLIENT_SECRET}
      GOOGLE_CALENDAR_REDIRECT_URI: ${GOOGLE_CALENDAR_REDIRECT_URI}
      # --- Notification Module: Email ---
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT:-587}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
      AWS_SES_REGION: ${AWS_SES_REGION:-ap-southeast-1}
      AWS_SES_ACCESS_KEY_ID: ${AWS_SES_ACCESS_KEY_ID}
      AWS_SES_SECRET_ACCESS_KEY: ${AWS_SES_SECRET_ACCESS_KEY}
      NOTIFICATION_FROM_EMAIL: ${NOTIFICATION_FROM_EMAIL:-no-reply@solavie.vn}
      NOTIFICATION_FROM_NAME: ${NOTIFICATION_FROM_NAME:-Solavie Solar Energy}
      # --- Notification Module: Zalo ZNS ---
      ZALO_OA_ID: ${ZALO_OA_ID}
      ZALO_OA_ACCESS_TOKEN: ${ZALO_OA_ACCESS_TOKEN}
      ZALO_ZNS_SECRET_KEY: ${ZALO_ZNS_SECRET_KEY}
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis-cache:
        condition: service_healthy
      redis-queue:
        condition: service_healthy
      minio:
        condition: service_healthy
    restart: always

volumes:
  pg_data:
  redis_cache_data:
  redis_queue_data:
  minio_data:
```
