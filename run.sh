#!/bin/bash

# Kiểm tra xem môi trường ảo đã tồn tại chưa
if [ ! -d "venv" ]; then
    echo "Môi trường ảo chưa được tạo. Đang tạo..."
    python3 -m venv venv
    echo "Đã tạo môi trường ảo."
fi

# Kích hoạt môi trường ảo
source venv/bin/activate

# Thêm đường dẫn môi trường ảo vào PATH
export PATH="$(pwd)/venv/bin:$PATH"

# Kiểm tra xem faster-whisper đã được cài đặt chưa
if ! pip list | grep -q faster-whisper; then
    echo "Faster-Whisper chưa được cài đặt. Đang cài đặt..."
    pip install --upgrade pip
    pip install setuptools-rust
    pip install faster-whisper
    echo "Đã cài đặt Faster-Whisper."
fi

# Kiểm tra thư mục uploads
if [ ! -d "uploads" ]; then
    mkdir -p uploads
    echo "Đã tạo thư mục uploads."
fi

# Chạy bot
echo "Khởi động Bot Telegram Tạo Phụ Đề Tự Động..."
npm start 