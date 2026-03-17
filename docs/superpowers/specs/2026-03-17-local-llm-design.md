# Local LLM Integration Design

**Date:** 2026-03-17
**Status:** Revised v2

## Overview

Add local AI inference to Bloom OS using LocalAI — a free, OpenAI-compatible inference server supporting LLM, STT (Whisper), TTS, and image generation. The service is baked into the NixOS image as OS-level infrastructure but disabled by default behind a feature flag. An optional offline-build mode fetches a default model at build time and bundles it into the image. Pi agent receives a bundled skill to discover and use the local AI endpoint.

## Goals

- Free, self-hosted local AI inference covering all four modalities: LLM, STT, TTS, image generation
- Minimal footprint in the image — no models pre-bundled unless offline mode is enabled
- Pi agent can call local AI as a fallback or alternative to cloud Claude
- Directly usable by operators without going through Pi
- Off by default; opt-in via NixOS options
- Optional fully-offline build that bundles a default model into the ISO

## Non-Goals

- Model management UI
- Automatic routing between local and cloud
- Container-based deployment (service_install pattern)

## Hardware Requirements

- Minimum: 8GB RAM (supports models up to ~7B params at Q4 quantization)
- Recommended: 16GB RAM (comfortable with 13B models at Q4, or 7B at higher quality)

## Default Offline Model

**omnicoder-9b-q4_k_m.gguf** (5.74GB):
- A 9B-parameter coding/general model at Q4_K_M quantization
- Works on 8GB minimum (~2GB headroom for OS + LocalAI); 16GB recommended for comfort
- Offline ISO size will be approximately 6-7GB with this model bundled
- Fetched at build time via `pkgs.fetchurl` with pinned SHA256 (reproducible)

## Architecture

### NixOS Module: `core/os/modules/bloom-llm.nix`

A new NixOS module. Since nixpkgs-unstable ships `pkgs.local-ai` (the binary) but no `services.localai` NixOS service module, we write our own `systemd.services` block following the `bloom-matrix.nix` pattern.

Two options are exposed:

```nix
options.bloom.localai = {
  enable = lib.mkEnableOption "Bloom local AI inference (LocalAI)";

  offlineModel = lib.mkOption {
    type    = lib.types.nullOr lib.types.package;
    default = null;
    description = ''
      Nix derivation producing a single GGUF model file (e.g. from pkgs.fetchurl).
      When set, the model is included in the Nix store and copied into
      /var/lib/localai/models/ at service start if not already present.
      Setting this option forces bloom.localai.enable = true regardless of the
      enable option value.
    '';
  };
};
```

**`enable` logic:**

```nix
let effectiveEnable = cfg.enable || cfg.offlineModel != null;
```

`offlineModel` takes precedence — if you set a model, the service starts. Explicitly setting `enable = false` alongside `offlineModel` is not a supported configuration.

**Service definition** (under `config = lib.mkIf effectiveEnable { ... }`):

```nix
systemd.services.localai = {
  description = "Bloom Local AI Inference (LocalAI)";
  after    = [ "network.target" ];
  wantedBy = [ "multi-user.target" ];

  serviceConfig = {
    Type            = "simple";
    ExecStartPre    = lib.mkIf (cfg.offlineModel != null) (
      pkgs.writeShellScript "localai-seed-model" ''
        dest=/var/lib/localai/models/${modelFileName}
        if [ ! -f "$dest" ]; then
          install -m 644 ${cfg.offlineModel} "$dest"
        fi
      ''
    );
    ExecStart       = "${pkgs.local-ai}/bin/local-ai run --address 0.0.0.0:11435 --models-path /var/lib/localai/models";
    Restart         = "on-failure";
    RestartSec      = 5;
    DynamicUser     = true;
    StateDirectory  = "localai localai/models";
    WorkingDirectory = "/var/lib/localai";
  };
};
```

Key decisions:
- **`ExecStartPre` instead of a separate seed service**: The seed script runs as the same `DynamicUser` as LocalAI, so file ownership is automatically correct. No inter-service ordering or separate user wiring needed.
- **`ExecStartPre` must be a string**: Use `"${pkgs.writeShellScript ...}"` (interpolated) — `serviceConfig.ExecStartPre` requires a string, not a bare derivation.
- **`--models-path /var/lib/localai/models`**: Explicitly tells LocalAI where to find models, including ones placed by `ExecStartPre`.
- **`--address 0.0.0.0:11435`**: Port `11435` avoids conflict with Bloom Home (`8080`), Matrix (`6167`), and Ollama's conventional `11434`.
- **`modelFileName`**: A hardcoded `let` binding set to `"omnicoder-9b-q4_k_m.gguf"`. This must exactly match the filename produced by the `offlineModel` derivation (i.e. the `pkgs.fetchurl` `name` attribute or the renamed output). It is used in both `ExecStartPre` (`dest=/var/lib/localai/models/${modelFileName}`) and documented in the skill.

### Skill Bundling: `core/pi-skills/local-llm/SKILL.md`

The skill file lives at `core/pi-skills/local-llm/SKILL.md` in the repo. It is bundled into the `bloom-app` Nix package (via `core/os/pkgs/bloom-app/default.nix`) and seeded into `~/Bloom/Skills/local-llm/` by the `bloom-garden` blueprints sync — no separate first-boot script needed. The `bloom-app` derivation must be updated to include the new `local-llm` skill directory.

Skill content covers:

**Service discovery:**
- Check if LocalAI is running: `systemctl status localai`
- API base URL: `http://localhost:11435/v1`
- List loaded models: `GET /v1/models`

**Endpoints by modality:**

| Modality | Endpoint | Notes |
|----------|----------|-------|
| LLM | `POST /v1/chat/completions` | OpenAI-compatible chat |
| STT | `POST /v1/audio/transcriptions` | Whisper models |
| TTS | `POST /v1/audio/speech` | Various TTS backends |
| Image | `POST /v1/images/generations` | Stable Diffusion backends |

**Offline mode:**
- When built with `bloom.localai.offlineModel` set, `omnicoder-9b-q4_k_m.gguf` is pre-loaded at `/var/lib/localai/models/`
- LocalAI starts automatically; use `GET /v1/models` to confirm the model name

**When to prefer local AI:**
- Offline or air-gapped operation
- Privacy-sensitive tasks (no data leaves the device)
- Bulk processing (no API rate limits)
- Audio transcription and synthesis

**When to use cloud Claude:**
- Tasks requiring strong reasoning or large context
- When local service is not enabled (`systemctl status localai` inactive)

### Host Config Update: `core/os/hosts/x86_64.nix`

Add `../modules/bloom-llm.nix` to the imports list. No behavior change since both options default to disabled/null.

### AGENTS.md Update

Add `local-llm` to the bundled skills list under `## 📜 Bundled Skills`.

## File Changes

| File | Change |
|------|--------|
| `core/os/modules/bloom-llm.nix` | New file — custom systemd service + options |
| `core/os/hosts/x86_64.nix` | Add `bloom-llm.nix` to imports |
| `core/os/pkgs/bloom-app/default.nix` | No change needed — derivation already copies `core/pi-skills/` wholesale |
| `core/pi-skills/local-llm/SKILL.md` | New file |
| `AGENTS.md` | Add `local-llm` to bundled skills list |

## Testing

- Default build — `systemctl status localai` inactive, port `11435` closed
- Online-enabled build (`bloom.localai.enable = true`) — service active, `curl http://localhost:11435/v1/models` returns JSON
- Offline build (`bloom.localai.offlineModel = <omnicoder-drv>`) — same as above, plus `omnicoder-9b-q4_k_m` appears in `GET /v1/models` without internet access
- Pi skill appears in `~/Bloom/Skills/local-llm/` after blueprints sync
