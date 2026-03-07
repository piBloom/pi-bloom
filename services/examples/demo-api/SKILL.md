---
name: demo-api
version: 0.1.0
description: Example HTTP service package used to demonstrate Bloom service lifecycle tooling
image: docker.io/mendhak/http-https-echo:31
---

# Demo API Service (Example)

This is a worked example service package for lifecycle docs and testing.

## API

The service listens on:

- `http://localhost:9080`

Example request:

```bash
curl -s http://localhost:9080
```

Expected behavior: returns request metadata and headers.

## Health Check

```bash
curl -sf http://localhost:9080/
```

## Local Install (manual from this example path)

```bash
cp services/examples/demo-api/quadlet/* ~/.config/containers/systemd/
mkdir -p ~/Bloom/Skills/demo-api
cp services/examples/demo-api/SKILL.md ~/Bloom/Skills/demo-api/SKILL.md
systemctl --user daemon-reload
systemctl --user start bloom-demo-api.service
```

## Notes

- This package lives under `services/examples/` as documentation material.
- For `just svc-push demo-api` or `just svc-install demo-api`, place it under `services/demo-api/`.
