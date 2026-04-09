# First Boot Setup

> Validating a fresh NixPI host after a plain base install

## Audience

Operators bringing up a fresh NixPI headless VPS.

## Prerequisites

Before this checklist, you should already have:

1. a completed plain-base install such as `nixpi-deploy-ovh`
2. SSH or console access to the installed machine
3. the intended primary user, hostname, timezone, and keyboard values for bootstrap

## What First Boot Means Now

NixPI comes up as a shell-first host runtime.

A fresh system should provide:

- a plain base system that boots normally before NixPI is layered on
- a bootstrap path that writes narrow `/etc/nixos` helper files
- an installed `/etc/nixos` flake that remains authoritative for host convergence
- a rebuild path that stays anchored to `/etc/nixos#nixos`
- a Pi runtime that becomes available after bootstrap completes

## First-Boot Checklist

### 1. Bootstrap NixPI on the machine

The first post-install action is to run `nixpi-bootstrap-host` on the machine.

```bash
nix run github:alexradunet/nixpi#nixpi-bootstrap-host -- \
  --primary-user alex \
  --ssh-allowed-cidr YOUR_ADMIN_IP/32 \
  --authorized-key-file /root/.ssh/authorized_keys \
  --timezone Europe/Bucharest \
  --keyboard us
```

Without `--hostname`, the installed host keeps the default `nixos` hostname.
The generated host stays in bootstrap mode after the first rebuild so SSH remains reachable while you validate the machine and switch normal access to the primary user.

If `/etc/nixos/flake.nix` already exists, follow the printed manual integration guidance and rebuild the host explicitly:

```bash
sudo nixos-rebuild switch --flake /etc/nixos#nixos --impure
```

### 2. Verify the base services

```bash
systemctl status nixpi-app-setup.service
systemctl status sshd.service
systemctl status nixpi-update.timer
```

Expected result: all three services are active or activatable.

### 3. Verify the runtime entry path

From SSH:

```bash
command -v pi
pi --help
ls -la ~/.pi
```

Expected result:

- the `pi` command is installed
- Pi is usable without any browser-only service layer
- user-home marker files are not the primary control plane for the host mode

After the first successful login, the operator-facing interface remains a plain shell. Run `pi` directly from that shell when you want the Pi workflow.

### 4. Verify the SSH hardening policy

```bash
sshd -T | grep -E 'passwordauthentication|permitrootlogin|allowtcpforwarding|allowagentforwarding'
sudo nft list ruleset | grep 'dport 22'
```

Expected result:

- `passwordauthentication no`
- `permitrootlogin no`
- SSH forwarding features remain disabled
- port `22` is only allowed from the configured admin CIDRs

### 5. Verify the rebuild path

Steady-state rebuilds should use the installed host flake:

```bash
sudo nixpi-rebuild
```

Manual recovery or existing-flake integration also rebuilds through the same host-owned root:

```bash
sudo nixos-rebuild switch --flake /etc/nixos#nixos --impure
```

Expected result:

- `sudo nixpi-rebuild` rebuilds from the installed host flake
- manual host rebuilds still target `/etc/nixos#nixos`
- the deployed system stays independent from any boot-time repo seeding

## Operator Orientation

After first boot, keep these boundaries in mind:

- the deployed NixOS config owns bootstrap and steady-state behavior
- the installed `/etc/nixos` flake remains authoritative for the running host
- NixPI is layered into the host through generated helper files, not by replacing the machine root
- user-home marker files are not the control path for transitioning host state
- SSH sessions are the operator control plane, with a plain shell as the default interactive UI
- shell behavior should already match the deployed NixOS configuration
- system services remain inspectable with normal NixOS and systemd tooling

## Reference

### Relevant Services

| Service | Purpose |
|------|---------|
| `nixpi-app-setup.service` | Provides the Pi runtime entry path |
| `sshd.service` | Remote shell access |

### Current Behavior Target

- the machine boots to a normal headless multi-user target
- no desktop session is required to start operating NixPI
- the primary user workflow is Pi in the terminal, reached directly from the shell
- updates run through native NixOS/systemd paths, and `sudo nixpi-rebuild` targets the installed host flake
- recovery from a bad SSH allowlist happens through OVH console or rescue mode
