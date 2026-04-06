# First Boot Setup

> Validating a fresh NixPI host after bootstrap

## Audience

Operators bringing up a fresh NixPI VPS, headless VM, or mini PC.

## Prerequisites

Before this checklist, you should already have:

1. a NixOS-capable x86_64 machine
2. a successful `nixpi-bootstrap-vps` run
3. the canonical checkout present at `/srv/nixpi`
4. a completed `sudo nixos-rebuild switch --flake /etc/nixos --impure`

## What First Boot Means Now

NixPI now expects the host to come up as a remote-first service platform.

A fresh system should come up with one remote operator surface:

- chat in the main web app
- a browser terminal at `/terminal/`
- Pi running in SDK mode inside the application process
- system management still anchored in `/srv/nixpi`

## First-Boot Checklist

### 1. Verify the Base Services

```bash
systemctl status nixpi-chat.service
systemctl status nixpi-ttyd.service
systemctl status nginx.service
systemctl status netbird.service
```

Expected result: all four services are active or activatable without any desktop login step.

### 2. Verify the Public App Surface and Internal Backend Probe

From the host itself:

```bash
# Public surface through nginx
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/terminal/

# Internal chat backend health probe (bypasses nginx)
curl -I http://127.0.0.1:8080/
```

Expected result:

- the main app responds on `/`
- the browser terminal responds on `/terminal/`
- `http://127.0.0.1:8080/` responds as the internal chat backend health probe

### 3. Verify NetBird Before Normal Use

```bash
netbird status
ip link show wt0
```

Expected result:

- NetBird reports a connected peer when enrollment is complete
- `wt0` exists before you rely on the deployment as your secure operator path

If NetBird is not enrolled yet, finish that step before treating the host as ready for routine remote access.

### 4. Verify the Canonical Repo Flow

```bash
cd /srv/nixpi
git status --short
sudo nixos-rebuild switch --flake /etc/nixos --impure
```

Expected result: the machine rebuilds from `/etc/nixos` while importing NixPI from `/srv/nixpi`, preserving the host's existing hardware and desktop configuration.

## Operator Orientation

After first boot, keep these boundaries in mind:

- `/srv/nixpi` is the canonical git working tree for sync, review, and rebuilds
- `/etc/nixos` is the host-owned flake root used for system rebuilds
- the remote web app is the default operator control plane
- `/terminal/` exists for shell-first recovery and administration
- a connected monitor on x86_64 hardware lands on a local `tty1` login prompt after boot
- Pi runs in SDK mode inside the app runtime rather than through a separate local-session story
- system services remain inspectable with normal NixOS and systemd tooling

## Reference

### Relevant Services

| Service | Purpose |
|------|---------|
| `nixpi-chat.service` | Main remote app runtime |
| `nixpi-ttyd.service` | Browser terminal backend |
| `nginx.service` | HTTP/HTTPS entry point |
| `netbird.service` | Mesh networking and remote security boundary |

### Current Behavior

- the machine boots to a normal headless multi-user target
- no desktop session is required to start operating NixPI
- the primary user workflow is remote web app plus browser terminal
- on monitor-attached x86_64 hardware, `tty1` remains available for local recovery
- updates and rollbacks are run from `/srv/nixpi`
- if the remote surface fails, service status and logs remain the first recovery tools, with the local monitor login prompt available as fallback on mini PCs

## Related

- [Quick Deploy](./quick-deploy)
- [Install NixPI](../install)
- [Live Testing](./live-testing)
