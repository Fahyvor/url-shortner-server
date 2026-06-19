FROM node:20-slim

# =========================
# SYSTEM DEPENDENCIES
# =========================
RUN apt-get update && apt-get install -y \
    python3 python3-pip \
    ffmpeg \
    curl wget ca-certificates \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# =========================
# yt-dlp INSTALL
# =========================
RUN pip3 install --break-system-packages "yt-dlp[default]"

# Verify tools
RUN yt-dlp --version && ffmpeg -version | head -1

# =========================
# WORKDIR
# =========================
WORKDIR /app

# =========================
# INSTALL DEPENDENCIES
# =========================
COPY package*.json ./
RUN npm install

# =========================
# COPY PROJECT FILES
# =========================
COPY . .

# =========================
# PRISMA FIX (IMPORTANT)
# =========================
RUN npx prisma generate

# =========================
# BUILD SAFETY (optional if you use TS)
# =========================
# RUN npm run build

# =========================
# PORT
# =========================
EXPOSE 9000

# =========================
# START APP
# =========================
CMD ["node", "server.js"]