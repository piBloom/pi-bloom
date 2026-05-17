# Minecraft MicroVM guest module

Canonical runtime: Nazar MicroVM only.

The module in this directory is intentionally service-only. The `/root/nazar` fleet baseline composes hardware-free MicroVM settings, networking, virtiofs persistence, lifecycle, and deploy policy around it.

Important paths:

- Service state: `/var/lib/minecraft` from the `minecraft-state` virtiofs share.
- Service repo: `/home/alex/minecraft` from the `minecraft-repo` virtiofs share.

Validate service changes in the guest with `nix flake check --no-build`, then commit and push. Production switching happens from `/root/nazar` with `nix flake lock --update-input minecraft`, `nix flake check --no-build`, and `nix run .#switch-minecraft`.
