---
name: whatsapp
version: 0.1.0
description: WhatsApp messaging bridge via Baileys — connects WhatsApp to Bloom's channel system
image: ghcr.io/alexradunet/bloom-whatsapp:latest
---

# WhatsApp Bridge

Connects WhatsApp to Bloom via the channel protocol (Unix socket at `/run/bloom/channels.sock`). Messages from WhatsApp users flow into Pi's session.

The bridge requires a channel token (`BLOOM_CHANNEL_TOKEN`) that is generated automatically by `service_install`.

## Setup

1. Install the service package
2. Start the service: `systemctl --user start bloom-whatsapp`
3. Check logs for QR code: `journalctl --user -u bloom-whatsapp -f`
4. Scan QR code with WhatsApp mobile app
5. Verify: `systemctl --user status bloom-whatsapp`

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

The bridge downloads audio, image, and video messages to `/var/lib/bloom/media/`.
Media metadata is forwarded to Pi via the channel protocol with file paths.
Pi can use installed services (e.g., Whisper) to process media files.
