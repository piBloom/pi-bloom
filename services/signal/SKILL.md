---
name: signal
version: 0.1.0
description: Signal messaging bridge via signal-cli (containerized)
image: localhost/bloom-signal:latest
---

# Signal Bridge

Bridges Signal messages to Pi via the bloom-channels Unix socket protocol. Uses signal-cli for the Signal protocol.

## Setup

### 1) Configure your Signal account

```bash
mkdir -p ~/.config/bloom
echo "SIGNAL_ACCOUNT=+1234567890" > ~/.config/bloom/signal.env
```

### 2) Install and start

Install the service package: `service_install(name="signal")`
- The container image is built automatically
- STT (whisper.cpp) is auto-installed as a dependency for voice message transcription

### 3) Pair with your Signal account

Run: `service_pair(name="signal")` — displays QR code inline.
Open Signal on your phone: Settings > Linked Devices > Link New Device > scan.

### 4) Verify

`service_test(name="signal")`

## Sending Messages

Use the `/signal` command in Pi to send a message:

```
/signal +1234567890 Hello from Bloom!
```

## Service Control

```bash
systemctl --user start bloom-signal.service
systemctl --user status bloom-signal
systemctl --user stop bloom-signal.service
journalctl --user -u bloom-signal -f
```

## Notes

- Signal requires a phone number for registration
- Device linking persists in the `bloom-signal-data` volume
- Media files (images, voice notes) are saved to `/var/lib/bloom/media/`
- Memory usage: ~512MB (Java runtime + Node.js bridge)
- The bridge reconnects automatically if bloom-channels restarts
