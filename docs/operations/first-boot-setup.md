# First Boot Setup

> Validating a fresh NixPI host after bootstrap

## Audience

Operators bringing up a fresh NixPI VPS, headless VM, or mini PC.

## Prerequisites

Before this checklist, you should already have:

1. a NixOS-capable x86_64 machine
2. a successful `nixpi-bootstrap-vps` run
3. the canonical checkout present at `/srv/nixpi`
4. a completed `sudo nixos-rebuild switch --flake /etc/nixos#nixos`

## What First Boot Means Now

NixPI now expects the host to come up as a remote-first service platform.

A fresh system should come up with one remote operator surface:

- Pi in the browser terminal at `/`
- an alias at `/terminal/`
- Pi running directly as the primary terminal interface
- system management still anchored in `/srv/nixpi`

## First-Boot Checklist

### 1. Verify the Base Services

```bash
systemctl status nixpi-ttyd.service
systemctl status nginx.service
systemctl status wireguard-wg0.service
```

Expected result: all four services are active or activatable without any desktop login step.

### 2. Verify the Public Pi Surface

From the host itself:

```bash
# Public surface through nginx
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/terminal/
```

Expected result:

- the Pi terminal responds on `/`
- `/terminal/` resolves to the same ttyd-backed terminal surface

### 3. Verify WireGuard Before Normal Use

```bash
systemctl status wireguard-wg0.service
wg show wg0
ip link show wg0
```

Expected result:

- `wireguard-wg0.service` is active
- `wg0` exists before you rely on the deployment as your secure operator path
- `wg show wg0` lists at least one peer once you have added your admin device

If WireGuard peers are not configured yet, finish that step before treating the host as ready for routine remote access.

### 4. Verify the Canonical Repo Flow

```bash
cd /srv/nixpi
git status
sudo nixpi-rebuild
```

Expected result: the machine rebuilds from `/etc/nixos` while importing NixPI from `/srv/nixpi`, preserving the host's existing hardware and desktop configuration.

To update the canonical checkout and rebuild in one step:

```bash
sudo nixpi-rebuild-pull
```

## Operator Orientation

After first boot, keep these boundaries in mind:

- `/srv/nixpi` is the canonical git working tree for sync, review, and rebuilds
- `/etc/nixos` is the standard flake root used for system rebuilds
- the browser Pi terminal is the default operator control plane
- `/` exists for shell-first operation and recovery
- a connected monitor on x86_64 hardware lands on a local `tty1` login prompt after boot
- Pi runs in SDK mode inside the app runtime rather than through a separate local-session story
- system services remain inspectable with normal NixOS and systemd tooling

## Reference

### Relevant Services

| Service | Purpose |
|------|---------|
| `nixpi-ttyd.service` | Pi terminal surface |
| `nginx.service` | HTTP/HTTPS entry point |
| `wireguard-wg0.service` | WireGuard remote-access boundary |

### Current Behavior

- the machine boots to a normal headless multi-user target
- no desktop session is required to start operating NixPI
- the primary user workflow is Pi in the terminal, reached from ttyd, SSH, or a local shell
- on monitor-attached x86_64 hardware, `tty1` remains available for local recovery
- updates and rollbacks are run from `/srv/nixpi`
- if the remote surface fails, service status and logs remain the first recovery tools, with the local monitor login prompt available as fallback on mini PCs

## Related

- [Quick Deploy](./quick-deploy)
- [Install NixPI](../install)
- [Live Testing](./live-testing)
