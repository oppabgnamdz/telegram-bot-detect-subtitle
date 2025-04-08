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

# Tạo môi trường ảo Python và cài đặt Whisper
RUN python3.9 -m venv venv && \
    . venv/bin/activate && \
    pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir openai-whisper

# Tạo thư mục uploads
RUN mkdir -p ./uploads

# Khai báo biến môi trường
ENV NODE_ENV=production \
    PATH="/app/venv/bin:$PATH" \
    PYTHONPATH="/app/venv/lib/python3.9/site-packages"

# Sao chép mã nguồn (đặt ở cuối để tận dụng cache)
COPY . .

# Khởi động ứng dụng
CMD ["/bin/bash", "-c", "source /app/venv/bin/activate && npm start"] 