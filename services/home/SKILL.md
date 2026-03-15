---
name: home
version: 0.1.0
description: NetBird landing page for Bloom service discovery and sharing
image: docker.io/library/nginx:1.29.1-alpine
---

# Bloom Home

Bloom Home is the default landing page for this device.

What it shows:

- Installed Bloom web services
- Preferred NetBird hostname or mesh IP to share
- Direct service URLs
- Known local path hints such as `~/Public/Bloom`

Default URL:

- `http://<netbird-name>:8080`

Notes:

- The page is generated locally from current service and NetBird state.
- It is intended for NetBird peers, not public internet exposure.
