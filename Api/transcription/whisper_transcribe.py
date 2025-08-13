#!/usr/bin/env python
import sys, json, os, tempfile, subprocess, time

"""
Simple wrapper script to transcribe an audio file using OpenAI Whisper (medium model) and emit
JSON with keys: full_text (str), words (list[{word,start,end}]).
Usage:
  python whisper_transcribe.py <audio_url> <output_json_path>
Notes:
  - Downloads the file locally (curl required) if a URL; if local path provided uses directly.
  - Requires: pip install openai-whisper==20231117 torch
  - FFmpeg must be installed and on PATH.
"""

try:
    import whisper
except ImportError:
    print(json.dumps({"error": "whisper not installed"}))
    sys.exit(1)

def download_if_url(src_path):
    if src_path.startswith('http://') or src_path.startswith('https://'):
        fd, tmp = tempfile.mkstemp(suffix='.audio')
        os.close(fd)
        cmd = ['curl', '-L', '-o', tmp, src_path]
        r = subprocess.run(cmd)
        if r.returncode != 0:
            raise RuntimeError('Failed to download audio')
        return tmp
    return src_path

if len(sys.argv) < 3:
    print(json.dumps({"error": "usage: python whisper_transcribe.py <audio_url_or_path> <output_json>"}))
    sys.exit(1)

src = sys.argv[1]
out_path = sys.argv[2]

try:
    local_audio = download_if_url(src)
    model = whisper.load_model('medium')
    # word timestamps
    result = model.transcribe(local_audio, word_timestamps=True)
    full_text = result.get('text', '').strip()
    words = []
    for seg in result.get('segments', []):
        for w in seg.get('words', []) or []:
            words.append({
                'word': w.get('word', '').strip(),
                'start': w.get('start'),
                'end': w.get('end')
            })
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'full_text': full_text, 'words': words, 'generated_at': time.time()}, f)
    print(json.dumps({'status': 'ok', 'output': out_path, 'length_words': len(words)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
