FROM node:20-bookworm-slim

# Install Python3, pip, venv, git, dan utilities yang dibutuhkan
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    git \
    curl \
    ca-certificates \
    procps \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# Buat direktori server dan workspace
WORKDIR /app

# Salin package.json & install dependencies server
COPY package.json ./
RUN npm install --omit=dev

# Salin source code server
COPY src/ ./src/

# Siapkan direktori workspace eksekusi sandbox
RUN mkdir -p /workspace && chown -R node:node /workspace /app

# Inisialisasi Python virtual environment di /workspace/.venv dan pasang library standar
USER node
RUN python3 -m venv /workspace/.venv \
    && /workspace/.venv/bin/pip install --no-cache-dir pillow matplotlib requests

# Set environment PATH agar default menggunakan python venv
ENV PATH="/workspace/.venv/bin:$PATH"
ENV NODE_ENV=production
ENV PORT=4000
ENV WORKSPACE_DIR=/workspace

EXPOSE 4000

CMD ["node", "src/index.js"]
