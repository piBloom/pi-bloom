# Nazar reproducible integration

NixPi is integrated into Nazar as a private, sshuttle-routed Pi web surface. The root flake imports this directory's module and package expression directly; `services/nixpi` is not a separate flake surface.

## Current production shape

- Source of truth: `services/nixpi` in this repository.
- Host adapter: `nix/modules/host/nixpi.nix`.
- Reusable module: `services/nixpi/nix/modules/nixpi-bun.nix`.
- Root package: `packages.x86_64-linux.nixpi-bun` / `nix build .#nixpi-bun`.
- Service unit: `nixpi-bun.service`.
- Backend bind: `127.0.0.1:4815`.
- Public exposure: none.
- Private route: host nginx serves `http://nixpi.nazar.studio/` on the sshuttle-routed private listener.
- Workspaces: host-local service directories configured in `nix/modules/host/nixpi.nix`.

Live-source mode remains available through the module's `sourceDir` option for development, but it is not the Nazar production path.

## Nazar constraints

- Private services stay behind sshuttle and host nginx on `10.44.0.1`.
- Do not publish public DNS or public HTTP for NixPi endpoints.
- NixPi runs centrally on the host; service workspaces are local root-repository paths.
- DAV data remains isolated in `dav-server`; NixPi should not co-locate DAV state or secrets.

## Routing

Canonical route:

- `nixpi.nazar.studio` -> host nginx private listener -> host NixPi service on `127.0.0.1:4815`.

Configured laptops get `/etc/hosts` entries from the Nazar laptop module so `nixpi.nazar.studio` resolves to `10.44.0.1` and is routed through sshuttle. Do not use `nazar.studio/nixpi/`; `nazar.studio` is the public static dashboard.

## Declarative exposure

Nazar keeps host HTTP exposure policy in `nix/fleet/exposure.nix`:

- `access = "private"` serves only on the sshuttle-routed private listener.
- `access = "public"` also serves on the host public IPv4 listener and opens public TCP/80.

Keep NixPi private unless a separate auth/hardening review happens.

## Deployment flow

After changes to NixPi or the host adapter, commit and push the monorepo, then switch Nazar from the repository root:

```bash
nix flake check --no-build
nix run .#switch-host
```

## Security stance

NixPi is an operator surface: it can drive Pi tools as `alex` in configured workspaces. Until NixPi has service-level authentication and authorization, keep it available only through the trusted sshuttle private path.

## Validation checklist

From the repository root after host module, route policy, or NixPi changes:

```bash
nix flake check --no-build
nix build .#nixpi-bun --no-link
nix develop .#nixpi --command make -C services/nixpi check
```

From the host:

```bash
systemctl is-active nixpi-bun nginx
curl -I http://127.0.0.1:4815/
curl -I --resolve nixpi.nazar.studio:80:10.44.0.1 http://nixpi.nazar.studio/
```

From a configured sshuttle client:

```bash
getent hosts nixpi.nazar.studio
curl -I http://nixpi.nazar.studio/
```
