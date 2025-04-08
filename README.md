# Telegram Bot Tạo Phụ Đề Tự Động

Bot Telegram giúp tạo phụ đề tự động cho video từ URL, sử dụng Whisper để nhận dạng giọng nói và OpenAI API để dịch sang tiếng Việt.

## Tính năng

- Tải video từ URL trực tiếp
- Trích xuất phụ đề bằng Whisper
- Dịch phụ đề sang tiếng Việt với OpenAI API
- Tùy chỉnh prompt dịch thuật
- Hỗ trợ nhiều loại video và ngôn ngữ
- Theo dõi tiến trình xử lý theo thời gian thực
- Hỗ trợ định dạng video trực tiếp (direct link) và HLS (m3u8)
- Có thể tải video từ nhiều nguồn như YouTube, Facebook, TikTok (cần thêm công cụ bên ngoài để lấy direct link)

## Yêu cầu hệ thống

- Node.js (v14 trở lên)
- Python 3.8+ (để chạy Whisper)
- FFmpeg
- Kết nối internet ổn định

## Cài đặt tự động

Sử dụng script cài đặt tự động (khuyến nghị):

```bash
chmod +x setup.sh
./setup.sh
```

Script này sẽ:

1. Kiểm tra và cài đặt các yêu cầu (Node.js, Python, FFmpeg)
2. Tạo môi trường ảo Python và cài đặt Whisper
3. Cài đặt các gói npm
4. Tạo file .env và thư mục uploads

## Cài đặt thủ công

### 1. Clone repository

```bash
git clone https://github.com/your-username/telegram-bot-detect-subtitle.git
cd telegram-bot-detect-subtitle
```

### 2. Cài đặt các gói npm

```bash
npm install
```

### 3. Cài đặt Whisper

```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install openai-whisper
```

### 4. Cấu hình môi trường

Tạo file `.env` với nội dung:

```
# Telegram Bot Token
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# OpenAI API Key
OPENAI_API_KEY=your_openai_api_key_here

# Whisper Model (tiny, base, small, medium, large)
WHISPER_MODEL=base

# File storage path
UPLOAD_PATH=./uploads
```

## Chạy ứng dụng

```bash
# Kích hoạt môi trường ảo Python (nếu chưa kích hoạt)
source venv/bin/activate

# Khởi động bot
npm start
```

Sử dụng nodemon để phát triển (tự động khởi động lại khi có thay đổi code):

```bash
npm run dev
```

## Lệnh Telegram Bot

Bot hỗ trợ các lệnh sau:

- `/start` - Hiển thị thông tin chào mừng và hướng dẫn
- `/help` - Hiển thị trợ giúp
- `/status` - Kiểm tra trạng thái của bot và cấu hình
- `/subtitle [URL video] [prompt dịch]` - Tạo và dịch phụ đề

## Cách sử dụng

1. Bắt đầu cuộc trò chuyện với bot bằng cách gửi lệnh `/start`
2. Kiểm tra trạng thái bot bằng lệnh `/status`
3. Sử dụng định dạng sau để tạo phụ đề:

```
/subtitle [URL video] [prompt dịch]
```

Ví dụ:

```
/subtitle https://example.com/video.mp4 Dịch phụ đề sang tiếng Việt, giữ nguyên nghĩa gốc
```

Hoặc sử dụng định dạng HLS (m3u8):

```
/subtitle https://example.com/stream.m3u8 Dịch phụ đề sang tiếng Việt
```

4. Bot sẽ tải video, trích xuất phụ đề, và gửi lại file phụ đề gốc và phụ đề đã dịch

## Xử lý sự cố

- **Lỗi timeout**: Nếu xử lý mất quá nhiều thời gian, hãy thử với video ngắn hơn hoặc chọn model Whisper nhỏ hơn trong file .env (tiny, base)
- **Whisper không được tìm thấy**: Đảm bảo bạn đã kích hoạt môi trường ảo Python trước khi chạy bot
- **Lỗi tải video**: Kiểm tra URL, đảm bảo nó là URL trực tiếp đến file video

## Lưu ý

- Bot có thể mất 5-10 phút để xử lý video dài, tùy thuộc vào model Whisper được chọn
- Cần đảm bảo URL video là trực tiếp và có thể tải được
- Model Whisper nhỏ hơn (tiny, base) xử lý nhanh hơn nhưng kém chính xác hơn
- Model Whisper lớn hơn (medium, large) chính xác hơn nhưng chậm hơn và cần nhiều RAM

## Tối ưu chi phí OpenAI

Để tối ưu chi phí sử dụng OpenAI API, bạn có thể:

1. **Whisper**:

   - Sử dụng model `tiny` thay vì `base` hoặc `large` (mặc định đã được cấu hình)
   - Chỉ sử dụng model lớn hơn khi cần độ chính xác cao
   - Giới hạn độ dài video xử lý

2. **GPT-3.5-turbo**:

   - Bot đã được cấu hình để xử lý phụ đề theo batch lớn hơn (100 dòng/lần)
   - Sử dụng temperature thấp (0.3) để có kết quả ổn định
   - Giới hạn max_tokens để tránh phát sinh chi phí không cần thiết

3. **Cấu hình thêm**:
   - Thay đổi model Whisper trong file `.env`: `WHISPER_MODEL=tiny`
   - Điều chỉnh batch_size trong `src/services/translationService.js` nếu cần

## Giấy phép

MIT

## Cập nhật Cookies YouTube

Để tải video từ YouTube, bot sử dụng cookies đăng nhập vào YouTube để vượt qua xác thực "bạn không phải là robot". Theo thời gian, cookies này có thể hết hạn và cần được cập nhật.

### Cách cập nhật cookies.txt

1. Trên máy cục bộ (đã đăng nhập YouTube trong Chrome):

   ```bash
   # Cài đặt thư viện cần thiết
   pip install browser-cookie3

   # Chạy script cập nhật cookies
   python update_cookies.py
   ```

2. Nếu bạn đang chạy trên server:
   - Chỉnh sửa file `server_cookies_update.sh` để cập nhật thông tin server
   - Chạy script để tự động cập nhật cookies lên server:
   ```bash
   ./server_cookies_update.sh
   ```

Cookies thường cần được cập nhật sau khoảng 1-2 tuần nếu gặp lỗi "Confirm you're not a robot" khi tải video.
