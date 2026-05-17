# DAV Server MicroVM guest module

Canonical runtime: Nazar MicroVM only.

The module in this directory is intentionally service-only. The `/root/nazar` fleet baseline composes hardware-free MicroVM settings, networking, virtiofs persistence, lifecycle, and deploy policy around it.

Important paths:

- DAV state: `/var/lib/dav-server` from the `dav-server-data` virtiofs share.
- Radicale collections: `/var/lib/radicale/collections` from the `dav-server-radicale` virtiofs share.

Validate service changes in the guest with `nix flake check --no-build`, then commit and push. Production switching happens from `/root/nazar` with `nix flake lock --update-input dav-server`, `nix flake check --no-build`, and `nix run .#switch-dav-server`.
