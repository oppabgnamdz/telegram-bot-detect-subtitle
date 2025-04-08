FROM node:16-slim

# Cài đặt các công cụ cần thiết
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Tạo thư mục làm việc
WORKDIR /app

# Sao chép package.json và package-lock.json
COPY package*.json ./

# Cài đặt dependencies cho Node.js
RUN npm install

# Sao chép mã nguồn
COPY . .

# Tạo môi trường ảo Python và cài đặt Whisper
RUN python3 -m venv venv && \
    . venv/bin/activate && \
    pip install --upgrade pip && \
    pip install openai-whisper

# Tạo thư mục uploads
RUN mkdir -p ./uploads

# Khai báo biến môi trường
ENV NODE_ENV=production
ENV PATH="/app/venv/bin:$PATH"

# Khởi động ứng dụng
CMD ["/bin/bash", "-c", "source /app/venv/bin/activate && npm start"] 