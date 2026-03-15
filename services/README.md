# Bloom Service Packages

This document is the operator-facing package reference for bundled services.

## 🌱 Why This Page Exists

Use this page when you need the current packaged service inventory and the practical install/runtime shape of those packages.

For capability-model decisions, use [../docs/service-architecture.md](../docs/service-architecture.md).

## 📦 How Bundled Packages Work

Bundled service packages live in `services/`.

Typical package:

```text
services/{name}/
  SKILL.md
  quadlet/
    bloom-{name}.container
  Containerfile     optional, for locally built images
```

Current install behavior:

1. find the package in the repo, system share, or current working tree
2. copy Quadlet files into user runtime locations
3. copy `SKILL.md` into `~/Bloom/Skills/{name}/`
4. create default env/config files in `~/.config/bloom/`
5. build local images for `localhost/*` refs when needed
6. reload and optionally start the user unit

## 📚 Reference

Current packages:

| Path | Role |
|------|------|
| `services/cinny/` | packaged Bloom Web Chat client using a pinned upstream image on port `8081` |
| `services/dufs/` | packaged WebDAV file server using a pinned upstream image on port `5000` |
| `services/code-server/` | packaged editor service built as a local image and exposed on port `8443` |
| `services/_template/` | scaffold template source for new packages |
| `services/catalog.yaml` | service and bridge metadata catalog |

Built-in infrastructure:

| Path | Role |
|------|------|
| Bloom Home | image-baked landing page on port `8080`, regenerated from installed web services |

Reference-only infrastructure docs:

| Path | Role |
|------|------|
| `docs/matrix-infrastructure.md` | Matrix infrastructure notes |
| `docs/netbird-infrastructure.md` | NetBird infrastructure notes |

Bridge tools use the `bridges:` section in `services/catalog.yaml` and do not require a per-bridge package directory under `services/`.

## 🔗 Related

- [../docs/service-architecture.md](../docs/service-architecture.md)
- [../docs/supply-chain.md](../docs/supply-chain.md)
