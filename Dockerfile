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
    && rm -rf /var/lib/apt/lists/*

# Cài đặt Rust và Cargo
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Tạo thư mục làm việc
WORKDIR /app

# Sao chép package.json và package-lock.json
COPY package*.json ./

# Cài đặt dependencies cho Node.js
RUN npm install

# Sao chép mã nguồn
COPY . .

# Tạo môi trường ảo Python và cài đặt Whisper
RUN python3.9 -m venv venv && \
    . venv/bin/activate && \
    pip install --upgrade pip && \
    pip install openai-whisper

# Tạo thư mục uploads
RUN mkdir -p ./uploads

# Khai báo biến môi trường
ENV NODE_ENV=production
ENV PATH="/app/venv/bin:$PATH"
ENV PYTHONPATH="/app/venv/lib/python3.9/site-packages"

# Khởi động ứng dụng
CMD ["/bin/bash", "-c", "source /app/venv/bin/activate && npm start"] 