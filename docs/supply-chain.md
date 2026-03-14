# Supply Chain and Image Policy

> 📖 [Emoji Legend](LEGEND.md)

This file documents the trust and reproducibility rules that match the current repository.

## Current Policy

### Published / Pulled Runtime Images

For packaged services and bridges, prefer:

1. digests
2. explicit non-`latest` tags

Disallowed by policy for normal remote images:

- implicit `latest`
- `latest*`

This rule is enforced by `validatePinnedImage()` for `service_scaffold`.

### Current Exception

`services/catalog.yaml` intentionally includes one mutable local-build image:

- `code-server` -> `localhost/bloom-code-server:latest`

Reason:

- the service is built locally from repository source before installation
- Bloom rebuilds the local image during install instead of trusting an already-present mutable tag
- the mutable tag refers to a local artifact, not to a remote registry trust decision

## What `service_install` Does Today

Depending on the package, installation may:

- copy Quadlet and skill assets from the bundled package
- rebuild a local image for `localhost/*` refs
- download declared model artifacts into Podman volumes
- update `~/Bloom/manifest.yaml`

This means installation is not fully hermetic today. It is reproducible at the package-layout level, but some flows
still depend on the local host and network.

## OS Image

The bootc image is built from `core/os/Containerfile` and current `justfile` targets.

Current expectations:

- build with `podman`
- install with `bootc`
- keep image- and package-related docs aligned with the actual build flow

## Review Checklist

- are remote runtime images pinned?
- are local-image exceptions documented?
- do docs describe the actual installation behavior, including local builds and downloads?
- does `services/catalog.yaml` still match the packaged services in the repo?

## Related

- [docs/service-architecture.md](service-architecture.md)
- [services/catalog.yaml](../services/catalog.yaml)
