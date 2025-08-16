FROM node:18-bullseye

# Install system dependencies: python3, pip, ffmpeg, curl, unzip, libsndfile1 (for soundfile)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  python3 python3-pip python3-venv ffmpeg curl unzip libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/Api

# Copy package.json and install Node deps (cache-friendly)
COPY package.json ./package.json
# Use npm install to avoid lockfile mismatches in this repo
RUN npm install --omit=dev

# Python deps for local transcription (wav2vec2 + torch CPU) and Vosk
RUN python3 -m pip install --no-cache-dir --upgrade pip \
  && python3 -m pip install --no-cache-dir \
    --index-url https://download.pytorch.org/whl/cpu \
    torch==2.2.2 \
  && python3 -m pip install --no-cache-dir \
     transformers==4.41.2 \
     accelerate==0.33.0 \
    soundfile==0.12.1 \
  numpy==1.26.4 \
  vosk==0.3.45

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

# (Optional) Download small Vosk English model (fits better on small RAM)
ENV VOSK_MODEL_DIR=/models/vosk
RUN mkdir -p /models \
  && cd /models \
  && curl -L -o vosk-small.zip https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip \
  && unzip -q vosk-small.zip \
  && rm vosk-small.zip \
  && mv vosk-model-small-en-us-0.15 vosk

EXPOSE 3001
ENV NODE_ENV=production \
  OMP_NUM_THREADS=1 \
  MKL_NUM_THREADS=1 \
  NUMEXPR_NUM_THREADS=1 \
  TOKENIZERS_PARALLELISM=false
CMD ["node", "index.js"]
