#!/bin/bash

# Script triển khai ứng dụng Telegram Bot lên server

# Cập nhật mã nguồn từ Git
git pull

# Tạo file .env nếu chưa tồn tại
if [ ! -f .env ]; then
    echo "Tạo file .env..."
    cat > .env << EOL
# Telegram Bot Token
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# OpenAI API Key
OPENAI_API_KEY=your_openai_api_key_here

# Whisper Model (tiny, base, small, medium, large)
WHISPER_MODEL=base

# File storage path
UPLOAD_PATH=./uploads
EOL
    echo "File .env đã được tạo. Vui lòng cập nhật thông tin API key trước khi tiếp tục."
    exit 1
fi

# Tạo thư mục uploads nếu chưa tồn tại
mkdir -p uploads

# Dừng và xóa container cũ (nếu có)
docker-compose down

# Xây dựng và khởi động container mới
docker-compose up -d --build

echo "Ứng dụng đã được triển khai thành công!"
echo "Kiểm tra logs với lệnh: docker-compose logs -f" 