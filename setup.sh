#!/bin/bash

# Kiểm tra và cài đặt các yêu cầu
echo "=== Cài đặt Bot Telegram Tạo Phụ Đề Tự Động ==="
echo ""

# Kiểm tra và cài đặt Node.js
if ! command -v node &> /dev/null; then
    echo "Node.js chưa được cài đặt. Vui lòng cài đặt Node.js và npm."
    echo "Truy cập https://nodejs.org/ để tải về và cài đặt."
    exit 1
else
    echo "✅ Node.js đã được cài đặt: $(node -v)"
fi

# Kiểm tra và cài đặt npm
if ! command -v npm &> /dev/null; then
    echo "npm chưa được cài đặt. Vui lòng cài đặt npm."
    exit 1
else 
    echo "✅ npm đã được cài đặt: $(npm -v)"
fi

# Kiểm tra và cài đặt Python
if ! command -v python3 &> /dev/null; then
    echo "Python 3 chưa được cài đặt. Vui lòng cài đặt Python 3."
    exit 1
else
    echo "✅ Python đã được cài đặt: $(python3 --version)"
fi

# Kiểm tra và cài đặt pip
if ! command -v pip3 &> /dev/null; then
    echo "pip3 chưa được cài đặt. Vui lòng cài đặt pip3."
    exit 1
else
    echo "✅ pip đã được cài đặt: $(pip3 --version)"
fi

# Kiểm tra và cài đặt ffmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "⚠️ ffmpeg chưa được cài đặt."
    
    # Kiểm tra hệ điều hành và cài đặt ffmpeg
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "Đang cài đặt ffmpeg cho Linux..."
        sudo apt-get update && sudo apt-get install -y ffmpeg
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Đang cài đặt ffmpeg cho macOS..."
        if command -v brew &> /dev/null; then
            brew install ffmpeg
        else
            echo "Homebrew chưa được cài đặt. Vui lòng cài đặt Homebrew từ https://brew.sh/ và sau đó cài đặt ffmpeg."
            exit 1
        fi
    else
        echo "Không thể tự động cài đặt ffmpeg cho hệ điều hành của bạn. Vui lòng cài đặt thủ công."
        exit 1
    fi
else
    echo "✅ ffmpeg đã được cài đặt: $(ffmpeg -version | head -n 1)"
fi

# Tạo và kích hoạt môi trường ảo Python
echo ""
echo "=== Tạo môi trường ảo Python ==="
python3 -m venv venv
source venv/bin/activate

# Cài đặt whisper
echo ""
echo "=== Cài đặt Whisper ==="
pip install --upgrade pip
pip install setuptools-rust
pip install openai-whisper

# Kiểm tra cài đặt whisper
if ! command -v whisper &> /dev/null; then
    echo "⚠️ Không tìm thấy lệnh whisper trong PATH. Vui lòng đảm bảo đường dẫn tới thư mục bin của môi trường ảo có trong biến PATH."
    echo "Bạn có thể thêm đường dẫn sau vào file .bashrc hoặc .zshrc:"
    echo "export PATH=\"$(pwd)/venv/bin:\$PATH\""
    
    # Thêm đường dẫn vào môi trường hiện tại
    export PATH="$(pwd)/venv/bin:$PATH"
    echo "✅ Đã tạm thời thêm đường dẫn vào PATH cho phiên làm việc hiện tại."
else
    echo "✅ Whisper đã được cài đặt thành công!"
fi

# Cài đặt các gói npm
echo ""
echo "=== Cài đặt các gói npm ==="
npm install

# Kiểm tra và tạo thư mục uploads nếu chưa tồn tại
mkdir -p uploads

# Kiểm tra và tạo file .env nếu chưa tồn tại
if [ ! -f .env ]; then
    echo ""
    echo "=== Tạo file .env ==="
    echo "# Telegram Bot Token" > .env
    echo "TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here" >> .env
    echo "" >> .env
    echo "# OpenAI API Key" >> .env
    echo "OPENAI_API_KEY=your_openai_api_key_here" >> .env
    echo "" >> .env
    echo "# Whisper Model (tiny, base, small, medium, large)" >> .env
    echo "WHISPER_MODEL=base" >> .env
    echo "" >> .env
    echo "# File storage path" >> .env
    echo "UPLOAD_PATH=./uploads" >> .env
    
    echo "✅ Đã tạo file .env. Vui lòng cập nhật thông tin token Telegram và API key OpenAI trong file này."
else
    echo "✅ File .env đã tồn tại."
fi

echo ""
echo "=== Cài đặt hoàn tất ==="
echo ""
echo "Để chạy bot:"
echo "1. Đảm bảo bạn đã cập nhật token Telegram và API key OpenAI trong file .env"
echo "2. Kích hoạt môi trường ảo: source venv/bin/activate"
echo "3. Khởi động bot: npm start"
echo ""
echo "Chúc mừng! Bot Telegram Tạo Phụ Đề Tự Động đã sẵn sàng sử dụng." 