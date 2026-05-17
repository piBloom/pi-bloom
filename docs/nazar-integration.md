# Nazar reproducible integration

NixPi is integrated into Nazar as a private, sshuttle-routed Pi web surface. Nazar production consumes this repository as a flake input and runs the reusable `services.nixpi-bun` NixOS module/package.

## Current production shape

- Source of truth: Nazar flake input `nixpi` (`git+ssh://alex@git.nazar.studio/nazar/nixpi-bun.git`).
- Host module: `nazar/nix/modules/host/nixpi.nix` configures `inputs.nixpi.nixosModules.nixpi-bun`.
- Runtime package: flake-built `nixpi-bun` package in the Nix store.
- Service unit: `nixpi-bun.service`.
- Backend bind: `127.0.0.1:4815`.
- Public exposure: none.
- Private route: host nginx serves `http://nixpi.nazar.studio/` on the sshuttle-routed private listener.
- Workspaces: host-local and SSH workspaces are generated from Nazar fleet data; VM work is reached through SSH into Pi agents, not by running per-VM NixPi HTTP services.

Live-source mode remains available through the module's `sourceDir` option for development, but it is not the Nazar production path.

## Nazar constraints

- Private services stay behind sshuttle and host nginx on `10.44.0.1`.
- Do not publish public DNS or public HTTP for NixPi endpoints.
- The `nazar` host owns VM lifecycle, VMID/IP/MAC, NAT/firewall, and public exposure.
- NixPi runs centrally on the host; VM work is reached through configured workspaces rather than VM-local NixPi services.
- Runtime VM auth propagation is owned by NixPi: before spawning remote Pi over SSH, NixPi copies host Pi auth/model files into the remote `$HOME/.pi/agent` directory.
- DAV data remains isolated in `dav-server`; NixPi should not co-locate DAV state or secrets.

## Routing

Canonical route:

- `nixpi.nazar.studio` -> host nginx private listener -> host NixPi service on `127.0.0.1:4815`.

Configured laptops get `/etc/hosts` entries from the Nazar laptop module so `nixpi.nazar.studio` resolves to `10.44.0.1` and is routed through sshuttle. Do not use `nazar.studio/nixpi/`; `nazar.studio` is the public static dashboard.

## Declarative exposure

Nazar keeps host HTTP exposure policy in `nix/fleet/exposure.nix`:

- `access = "private"` serves only on the sshuttle-routed private listener.
- `access = "public"` also serves on the host public IPv4 listener and opens public TCP/80.

VM private service domains come from `nix/fleet/vms.nix` `privateAccess`. Keep NixPi private unless a separate auth/hardening review happens.

## Deployment flow

After changes to this repository, push them and update Nazar's flake input:

```bash
cd /root/nazar
nix flake lock --update-input nixpi
nix run .#switch-host
```

## Security stance

NixPi is an operator surface: it can drive Pi tools as `alex` in configured workspaces. Until NixPi has service-level authentication and authorization, keep it available only through the trusted sshuttle private path.

## Validation checklist

From `/root/nazar` after changes to the host module, route policy, or `nixpi` flake input:

```bash
nix flake check --no-build
nix run .#switch-host
```

From `/home/alex/repos/nixpi` after app changes:

```bash
node --check server.js
node --check pi-rpc.js
node --check public/app.js
node --check public/ds/topbar-actions.js
nix develop --command make check
nix build .#nixpi-bun --no-link
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
