FROM node:18-bullseye

# Install system dependencies: python3, pip, ffmpeg, curl
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ffmpeg curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/Api

# Copy package.json and install Node deps (cache-friendly)
COPY package.json ./package.json
# Use npm install to avoid lockfile mismatches in this repo
RUN npm install --omit=dev

# Python deps for local transcription (wav2vec2 + torch CPU)
RUN python3 -m pip install --no-cache-dir --upgrade pip \
  && python3 -m pip install --no-cache-dir \
    torch==2.2.2+cpu \
    --find-links https://download.pytorch.org/whl/cpu \
  && python3 -m pip install --no-cache-dir \
    transformers==4.41.2 \
    soundfile==0.12.1 \
    numpy==1.26.4

# Copy the rest of the API source
COPY . .

# (Optional) Pre-warm wav2vec2 model cache to reduce cold-starts
ENV WAV2VEC2_MODEL=facebook/wav2vec2-base-960h
RUN python3 - <<'PY'
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
import os
model_id = os.environ.get('WAV2VEC2_MODEL','facebook/wav2vec2-base-960h')
try:
   Wav2Vec2Processor.from_pretrained(model_id)
   Wav2Vec2ForCTC.from_pretrained(model_id)
   print('Wav2Vec2 model cached:', model_id)
except Exception as e:
   print('Wav2Vec2 preload failed:', e)
PY

EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "index.js"]
