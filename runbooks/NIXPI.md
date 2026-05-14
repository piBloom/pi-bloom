# NixPi Runbook

NixPi is the private browser interface for Pi Coding Agent in Nazar. It reuses Pi RPC (`pi --mode rpc`) and runs one service on the host plus one service in each concrete MicroVM.

## Exposure model

NixPi is an operator surface: it can drive Pi as `alex` in the configured working directory. Keep it private behind sshuttle only.

Primary per-service paths:

- Host UI: `http://nazar.studio/nixpi/` -> host `127.0.0.1:4815`
- Minecraft VM UI: `http://mc.nazar.studio/nixpi/` -> `10.10.10.30:4815`
- DAV Server VM UI: `http://dav.nazar.studio/nixpi/` -> `10.10.10.41:4815`

NixPi is path-based only. There are no dedicated `nixpi*.nazar.studio` virtual hosts; use the `/nixpi/` path on the host or service domain.

Private/operator hostnames resolve to `10.44.0.1` through declarative laptop `/etc/hosts` entries and are proxied by host nginx. `nazar.studio` and `mc.nazar.studio` may also have public DNS, but their NixPi paths are only served on the private listener.

## Declarative exposure switch

HTTP route policy lives in `nix/fleet/exposure.nix`.

Each route has an `access` value:

- `"private"` — route is served only on host nginx's sshuttle-routed private listener (`10.44.0.1:80`).
- `"public"` — route is also served on the host public IPv4 listener and opens public TCP/80.

NixPi routes are private-only. The host static page is public; to intentionally publish a future route such as `/subagent/`, enable it and set its access explicitly, for example:

```nix
vms.git.subagent = {
  enable = true;
  path = "/subagent/";
  port = 4815;
  access = "public";
};
```

Do not set `access = "public"` for NixPi unless the operator surface has had a separate auth/hardening review.

## State

Each MicroVM has a persistent virtiofs share mounted at `/home/alex/.pi`, backed by:

- `/persist/microvms/git/pi`
- `/persist/microvms/minecraft/pi`
- `/persist/microvms/dav-server/pi`

This keeps Pi config and NixPi session history across VM recreation. The host service uses `/home/alex/.pi` on the host.

## Input source

The Nazar flake uses the private SSH-only Git repository:

```nix
git+ssh://alex@git.nazar.studio/nazar/nixpi.git
```

Update it from `/root/nazar` with:

```bash
nix flake lock --update-input nixpi
```

## Switch

From `/root/nazar` on the host:

```bash
nix flake check --no-build
sudo nix --accept-flake-config build .#nixosConfigurations.nazar.config.system.build.toplevel --print-build-logs
sudo nixos-rebuild switch --flake .#nazar
```

Then switch/restart MicroVMs as usual if needed:

```bash
nix run .#switch-minecraft
nix run .#switch-dav-server
```

## Validate

On the host:

```bash
systemctl is-active nixpi nginx
curl -I http://127.0.0.1:4815/
curl -I --resolve nazar.studio:80:10.44.0.1 http://nazar.studio/nixpi/
```

From a configured sshuttle laptop:

```bash
systemctl status nazar-sshuttle
getent hosts nazar.studio mc.nazar.studio dav.nazar.studio git.nazar.studio
curl -I http://nazar.studio/nixpi/
curl -I http://mc.nazar.studio/nixpi/
curl -I http://dav.nazar.studio/nixpi/
```

Inside each VM:

```bash
systemctl is-active nixpi
curl -I http://127.0.0.1:4815/
```

## Troubleshooting 502 Bad Gateway

A 502 from `*/nixpi/` means host nginx is reachable but the backend NixPi service is not reachable. Check:

```bash
# host
systemctl status nginx
journalctl -u nginx -n 100 --no-pager

# matching VM
ssh alex@<vm-hostname>
systemctl status nixpi
curl -I http://127.0.0.1:4815/
```

If the host was rebuilt but the VM was not switched/restarted, run the relevant switch app (`nix run .#switch-minecraft` or `.#switch-dav-server`) so the VM-local `nixpi` systemd service exists and is running.

## Rollback

Host rollback:

```bash
sudo nixos-rebuild switch --rollback
```

VM rollback:

```bash
nix run .#switch-<vm> -- --rollback
# or inside a VM if the VM-local self flake is healthy:
sudo nixos-rebuild switch --rollback
```
