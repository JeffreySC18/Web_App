#!/usr/bin/env python3
import sys, json, os, tempfile, subprocess, wave, time

"""
Transcribe audio to text using Vosk (offline ASR).
Outputs JSON: { full_text: str, words: [{word,start,end}], generated_at }
Usage:
  python vosk_transcribe.py <audio_url_or_path> <output_json_path>

Notes:
  - If src is a URL, downloads via curl first.
  - Converts input to 16kHz mono WAV via ffmpeg for consistent decoding.
  - Requires: pip install vosk; apt-get install unzip to fetch model during build.
  - Set VOSK_MODEL_DIR to the unpacked model path (default: /models/vosk).
"""

MODEL_DIR = os.environ.get('VOSK_MODEL_DIR', '/models/vosk')

try:
    from vosk import Model, KaldiRecognizer
except Exception as e:
    print(json.dumps({"error": f"vosk not installed: {e}"}))
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
    cmd = [
        'ffmpeg', '-y', '-i', src_path,
        '-ac', '1', '-ar', '16000',
        '-f', 'wav', wav_path
    ]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise RuntimeError('ffmpeg conversion failed')
    return wav_path


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: python vosk_transcribe.py <audio_url_or_path> <output_json>"}))
        sys.exit(1)

    src = sys.argv[1]
    out_path = sys.argv[2]
    tmp_files = []
    try:
        if not os.path.isdir(MODEL_DIR):
            raise RuntimeError(f"VOSK model directory not found: {MODEL_DIR}")
        local_audio = download_if_url(src)
        if local_audio != src:
            tmp_files.append(local_audio)
        wav16 = ffmpeg_to_wav16k(local_audio)
        tmp_files.append(wav16)

        model = Model(MODEL_DIR)
        wf = wave.open(wav16, "rb")
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != 16000:
            raise RuntimeError("wav parameters unexpected after ffmpeg conversion")

        rec = KaldiRecognizer(model, wf.getframerate())
        rec.SetWords(True)

        results = []
        while True:
            data = wf.readframes(4000)
            if len(data) == 0:
                break
            if rec.AcceptWaveform(data):
                part = rec.Result()
                try:
                    results.append(json.loads(part))
                except Exception:
                    pass
        final = json.loads(rec.FinalResult())
        results.append(final)

        words = []
        text_parts = []
        for r in results:
            if 'text' in r and r['text']:
                text_parts.append(r['text'])
            if 'result' in r:
                for w in r['result']:
                    words.append({
                        'word': w.get('word', ''),
                        'start': w.get('start'),
                        'end': w.get('end')
                    })

        full_text = ' '.join([t for t in text_parts if t]).strip()

        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump({'full_text': full_text, 'words': words, 'generated_at': time.time()}, f)
        print(json.dumps({'status': 'ok', 'output': out_path, 'len': len(full_text), 'words': len(words)}))
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
