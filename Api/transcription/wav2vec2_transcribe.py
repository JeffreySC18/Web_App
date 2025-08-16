#!/usr/bin/env python3
import sys, json, os, tempfile, subprocess, time

"""
Transcribe audio to text using Hugging Face Wav2Vec2 (facebook/wav2vec2-base-960h).
Outputs JSON: { full_text: str, words: [], generated_at: epoch_seconds }
Usage:
  python wav2vec2_transcribe.py <audio_url_or_path> <output_json_path>

Notes:
  - If src is a URL, downloads via curl first.
  - Converts input to 16kHz mono WAV via ffmpeg for consistent decoding.
  - Requires: pip install transformers torch soundfile librosa
  - ffmpeg must be installed and on PATH.
"""

MODEL_ID = os.environ.get('WAV2VEC2_MODEL', 'facebook/wav2vec2-base-960h')

try:
    import numpy as np
    import soundfile as sf
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
    import torch
except Exception as e:
    print(json.dumps({"error": f"python deps missing: {e}"}))
    sys.exit(1)


def download_if_url(src_path: str) -> str:
    if src_path.startswith('http://') or src_path.startswith('https://'):
        fd, tmp = tempfile.mkstemp(suffix='.audio')
        os.close(fd)
        cmd = ['curl', '-L', '-o', tmp, src_path]
        r = subprocess.run(cmd)
        if r.returncode != 0:
            raise RuntimeError('Failed to download audio')
        return tmp
    return src_path


def ffmpeg_to_wav16k(src_path: str) -> str:
    fd, wav_path = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    # Convert to mono 16k PCM WAV
    cmd = [
    'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', src_path,
        '-ac', '1', '-ar', '16000',
        '-f', 'wav', wav_path
    ]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise RuntimeError('ffmpeg conversion failed')
    return wav_path


def load_audio(path_wav: str):
    audio, sr = sf.read(path_wav)
    # Ensure float32 mono
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)
    if audio.dtype != np.float32:
        audio = audio.astype(np.float32)
    # Simple peak normalization to improve recognition on quiet inputs
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1e-6:
        target = 0.8
        if peak < target:
            audio = audio * (target / max(peak, 1e-6))
    return audio, sr


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: python wav2vec2_transcribe.py <audio_url_or_path> <output_json>"}))
        sys.exit(1)

    src = sys.argv[1]
    out_path = sys.argv[2]
    tmp_files = []
    try:
        local_audio = download_if_url(src)
        if local_audio != src:
            tmp_files.append(local_audio)
        wav16 = ffmpeg_to_wav16k(local_audio)
        tmp_files.append(wav16)

        audio, sr = load_audio(wav16)
        if sr != 16000:
            raise RuntimeError(f"unexpected sample rate: {sr}")

        torch.set_num_threads(1)
        processor = Wav2Vec2Processor.from_pretrained(MODEL_ID)
        try:
            model = Wav2Vec2ForCTC.from_pretrained(MODEL_ID, low_cpu_mem_usage=True)
        except Exception:
            # Fallback if accelerate isn't available or model doesn't support the flag
            model = Wav2Vec2ForCTC.from_pretrained(MODEL_ID)
        with torch.no_grad():
            inputs = processor(audio, sampling_rate=16000, return_tensors="pt", padding=True)
            # Ensure tensors on CPU and free mem as soon as possible
            input_values = inputs.input_values.contiguous()
            logits = model(input_values).logits
            pred_ids = torch.argmax(logits, dim=-1)
            text = processor.batch_decode(pred_ids)[0]
        full_text = text.strip()

        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump({'full_text': full_text, 'words': [], 'generated_at': time.time()}, f)
        print(json.dumps({'status': 'ok', 'output': out_path, 'len': len(full_text)}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
    finally:
        for p in tmp_files:
            try:
                os.remove(p)
            except Exception:
                pass


if __name__ == '__main__':
    main()
