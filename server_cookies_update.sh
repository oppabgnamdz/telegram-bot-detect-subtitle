#!/bin/bash

# Script để cập nhật cookies trên server
# Phải chạy script này từ máy cục bộ đã đăng nhập YouTube

# Kiểm tra browser-cookie3 đã được cài đặt chưa
if ! pip show browser-cookie3 > /dev/null 2>&1; then
    echo "Cài đặt browser-cookie3..."
    pip install browser-cookie3
fi

# Tạo file cookies.txt mới từ trình duyệt
echo "Đang tạo cookies.txt từ trình duyệt Chrome..."
python update_cookies.py

# Kiểm tra kết quả
if [ $? -ne 0 ]; then
    echo "Lỗi khi tạo cookies.txt!"
    exit 1
fi

# Xác định server (cần thay thế bằng địa chỉ server thực tế)
SERVER_HOST="your-server-hostname-or-ip"
SERVER_USER="your-server-username"
SERVER_PATH="/path/to/telegram-bot-detect-subtitle"

# Upload cookies.txt lên server
echo "Đang upload cookies.txt lên server..."
scp cookies.txt $SERVER_USER@$SERVER_HOST:$SERVER_PATH/

if [ $? -ne 0 ]; then
    echo "Lỗi khi upload cookies.txt lên server!"
    exit 1
fi

# Khởi động lại container
echo "Đang khởi động lại container..."
ssh $SERVER_USER@$SERVER_HOST "cd $SERVER_PATH && docker-compose restart"

if [ $? -ne 0 ]; then
    echo "Lỗi khi khởi động lại container!"
    exit 1
fi

echo "Cập nhật cookies.txt thành công!"
echo "Cookies mới đã được cập nhật trên server và container đã được khởi động lại." 