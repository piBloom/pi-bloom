---
name: whisper
version: 0.1.0
description: Speech-to-text transcription via faster-whisper (OpenAI-compatible API)
image: docker.io/fedirz/faster-whisper-server@sha256:760e5e43d427dc6cfbbc4731934b908b7de9c7e6d5309c6a1f0c8c923a5b6030
---

# Whisper Service

Transcribes audio files to text using faster-whisper. Runs locally on CPU.

## API

OpenAI-compatible endpoint at `http://localhost:9000`.

### Transcribe Audio

POST http://localhost:9000/v1/audio/transcriptions

```bash
curl -X POST http://localhost:9000/v1/audio/transcriptions \
  -F "file=@/path/to/audio.ogg" \
  -F "language=en"
```

Response: `{ "text": "transcribed text" }`

Supported formats: wav, mp3, ogg, flac, m4a, webm

### Health Check

```bash
curl -sf http://localhost:9000/health
```

## Socket Activation

Whisper is socket-activated via `bloom-whisper.socket`:

```bash
systemctl --user enable --now bloom-whisper.socket
```

The container starts on first request to `localhost:9000`.

## Notes

- First start downloads ~500MB model — may take several minutes
- Memory usage: ~1-2GB during transcription
- Audio files from WhatsApp are at `/var/lib/bloom/media/`
- Model: Systran/faster-whisper-small (CPU int8, optimized for mini-PCs)
