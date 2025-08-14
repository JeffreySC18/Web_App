# Build a Node + Python + FFmpeg image for local Whisper transcription
# Use an official Node base image with Debian for apt access
FROM node:20-bullseye

# Install Python3, pip, ffmpeg, curl
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

# Set workdir
WORKDIR /app

# Copy package manifests and install Node deps first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy API source
COPY . .

# Python deps for Whisper (CPU-only)
# Pin whisper and allow torch to choose a CPU wheel automatically
RUN pip3 install --no-cache-dir openai-whisper==20231117 torch --extra-index-url https://download.pytorch.org/whl/cpu

# Expose the port Render will map; Render sets PORT env variable at runtime
ENV NODE_ENV=production

# Start
CMD ["npm", "start"]
