---
name: whatsapp
version: 0.3.0
description: WhatsApp messaging bridge via Baileys (containerized)
image: localhost/bloom-whatsapp:latest
---

# WhatsApp Bridge

Connects WhatsApp to Bloom via the channel protocol (Unix socket at `$XDG_RUNTIME_DIR/bloom/channels.sock`). Uses Baileys to connect directly to WhatsApp's WebSocket servers — no browser needed.

## Setup

1. Install the service package: `service_install(name="whatsapp")`
   - STT (whisper.cpp) is auto-installed as a dependency for voice message transcription
2. Pair: `service_pair(name="whatsapp")` — displays QR code inline
3. Scan the QR code with WhatsApp mobile app (Settings > Linked Devices > Link a Device)
4. Verify: `service_test(name="whatsapp")`

## Pairing

Use `service_pair(name="whatsapp")` to get a fresh QR code inline in conversation. Auth state persists in the `bloom-whatsapp-auth` volume — you only need to pair once.

## Sending Messages

Use the `/wa` command in Pi to send outbound WhatsApp messages.

## Troubleshooting

- **Won't start**: Check logs: `journalctl --user -u bloom-whatsapp -n 100`
- **Connection lost**: Restart: `systemctl --user restart bloom-whatsapp`
- **Auth expired**: Remove auth volume and re-scan QR:
  ```bash
  systemctl --user stop bloom-whatsapp
  podman volume rm bloom-whatsapp-auth
  systemctl --user start bloom-whatsapp
  ```

## Media Support

The bridge downloads audio, image, and video messages to `/var/lib/bloom/media/` (bind-mounted into the container at `/media/bloom`).
Media metadata is forwarded to Pi via the channel protocol with file paths.
Pi can use installed services (e.g., bloom-stt for transcription) to process media files.
