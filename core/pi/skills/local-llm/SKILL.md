---
name: local-llm
description: Use local LLM inference (llama-server) with the bundled Qwen 3.5 4B GGUF model
---

# Local LLM (llama-server)

llama-server runs on every nixPI instance and is always available at boot. It provides an OpenAI-compatible API for LLM inference.

## Service

llama-server is a system service managed by systemd:

```bash
systemctl status localai          # check status
sudo systemctl restart localai    # restart if needed
```

API base URL: `http://localhost:11435/v1`

List loaded models:
```bash
curl http://localhost:11435/v1/models
```

## Default Model

`Qwen3.5-4B-Q4_K_M` is pre-loaded at boot. No download needed.

## LLM Inference

```bash
curl http://localhost:11435/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3.5-4B-Q4_K_M",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Changing the Model

llama-server loads a single model at startup specified via `--model` in the systemd service. The default is `Qwen3.5-4B-Q4_K_M.gguf`.

To switch models, update `core/os/modules/llm.nix` in the nixPI repo:
- Change `modelFileName` to the new GGUF filename
- Update the `pkgs.fetchurl` URL and SHA256
- Rebuild the OS: `sudo nixos-rebuild switch --flake <flake>`

## When to Use Local vs Cloud

**Prefer local:**
- Offline or air-gapped operation
- Privacy-sensitive tasks (nothing leaves the device)
- Bulk processing (no rate limits)

**Prefer cloud Claude:**
- Tasks requiring strong reasoning or very large context
