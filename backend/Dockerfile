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
