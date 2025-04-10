FROM node:16-bullseye

# Cài đặt các công cụ cần thiết và Python 3.9
RUN apt-get update && apt-get install -y \
    python3.9 \
    python3.9-venv \
    python3.9-dev \
    python3-pip \
    ffmpeg \
    git \
    curl \
    build-essential \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Cài đặt yt-dlp từ GitHub
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    /usr/local/bin/yt-dlp --version

# Cài đặt Rust và Cargo với các flags tối ưu
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
ENV PATH="/root/.cargo/bin:${PATH}"
ENV RUSTFLAGS="-C target-cpu=native"

# Tạo thư mục làm việc
WORKDIR /app

# Sao chép package.json và package-lock.json
COPY package*.json ./

# Cài đặt dependencies cho Node.js với các flags tối ưu
RUN npm ci --only=production

# Tạo môi trường ảo Python và cài đặt Faster-Whisper
RUN python3.9 -m venv venv && \
    . venv/bin/activate && \
    pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir faster-whisper

# Tạo thư mục uploads
RUN mkdir -p ./uploads && chmod 777 ./uploads

# Khai báo biến môi trường
ENV NODE_ENV=production \
    PATH="/app/venv/bin:/usr/local/bin:$PATH" \
    PYTHONPATH="/app/venv/lib/python3.9/site-packages"

# Sao chép cookies.txt (sẽ bỏ qua nếu không tồn tại)
COPY cookies.txt* ./
# Đảm bảo quyền đọc cho cookies.txt
RUN chmod 644 cookies.txt 2>/dev/null || true

# Sao chép mã nguồn (đặt ở cuối để tận dụng cache)
COPY . .

# Khởi động ứng dụng
CMD ["/bin/bash", "-c", "source /app/venv/bin/activate && npm start"] 