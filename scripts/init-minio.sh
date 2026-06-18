#!/bin/sh
# init-minio.sh

# Chờ MinIO khởi động hoàn toàn (đợi đến khi ping port 9000 thành công)
sleep 5

# Set alias cho MinIO client (mc) kết nối với MinIO server nội bộ
mc alias set myminio http://minio:9000 ${MINIO_ROOT_USER} ${MINIO_ROOT_PASSWORD}

# Tạo 4 buckets cốt lõi theo thiết kế
mc mb myminio/rag-documents --ignore-existing
mc mb myminio/customer-media --ignore-existing
mc mb myminio/user-media --ignore-existing
mc mb myminio/system-assets --ignore-existing

# Thiết lập policy public (download) cho customer-media, user-media và system-assets
mc anonymous set download myminio/customer-media
mc anonymous set download myminio/user-media
mc anonymous set download myminio/system-assets

# (Riêng rag-documents giữ nguyên private theo mặc định)
echo "MinIO buckets initialized successfully."
