# sshuttle Access Runbook

sshuttle over OpenSSH is the canonical private access path for Nazar.

## Server model

- Public control endpoint: `alex@167.235.12.22:22`
- SSH policy: key-only, `alex` only, root login disabled
- Private service address: `10.44.0.1/32` on host-local dummy interface `nazar-private`
- Private HTTP entrypoint: host nginx on `10.44.0.1:80`
- Private Git SSH entrypoint: host sshd on `10.44.0.1:22` (standard SSH as `alex`)

The private address is not assigned to the public NIC. Clients reach it by running sshuttle, which creates local routing/firewall rules and forwards matching TCP connections through SSH.

## Laptop model

`nix/modules/laptop/nazar-sshuttle.nix` declares:

- `programs.ssh` host alias `nazar-sshuttle`
- pinned Nazar SSH host key
- `/etc/hosts` entries for private service names -> `10.44.0.1`
- `nazar-sshuttle.service`
- `pkgs.sshuttle` in the system profile

The service is gated by:

```text
ConditionPathExists=/home/alex/.ssh/id_ed25519
```

so the laptop config can be applied without committing the private key.

## Client key setup

Use the existing laptop private key if its public half is already listed in:

```text
nix/users/alex-public-ssh-keys.nix
```

The default laptop configuration expects the matching private key at:

```text
/home/alex/.ssh/id_ed25519
```

If the private key has a different filename, override `nazar.access.sshuttle.keyPath` in the laptop host config. If adding a new laptop key, commit only the public key to `nix/users/alex-public-ssh-keys.nix`, deploy the host, then rebuild the laptop.

## First laptop bootstrap

A fresh laptop may not yet have the declarative `/etc/hosts` entries needed to fetch this flake's private Git inputs. For the first rebuild only, start a temporary sshuttle tunnel and temporary hosts entry from an existing checkout:

```bash
sudo sh -c 'printf "10.44.0.1 nazar.studio mc.nazar.studio git.nazar.studio dav.nazar.studio\n" >> /etc/hosts'
nix shell nixpkgs#sshuttle -c sudo sshuttle --method=auto \
  -e "ssh -i /home/alex/.ssh/id_ed25519 -o IdentitiesOnly=yes" \
  -r alex@167.235.12.22 \
  -x 167.235.12.22 \
  10.44.0.1/32
```

Leave that command running in one terminal, run the normal rebuild in another, then remove the temporary `/etc/hosts` line after the declarative config is active.

## Start/check on laptop

```bash
sudo nixos-rebuild switch --flake .#alex-laptop
systemctl status nazar-sshuttle
getent hosts nazar.studio mc.nazar.studio git.nazar.studio dav.nazar.studio
```

The generated command is equivalent to:

```bash
sshuttle --method=auto -r nazar-sshuttle -x 167.235.12.22 10.44.0.1/32
```

## Access services

Use normal service URLs; no browser SOCKS configuration is required:

```bash
curl -I http://nazar.studio/
curl -I http://nixpi.nazar.studio/
curl -I http://dav.nazar.studio/
git ls-remote ssh://alex@git.nazar.studio/nazar/nazar.git
```

## Troubleshooting

Check laptop service logs:

```bash
journalctl -u nazar-sshuttle -n 100 --no-pager
```

Check the SSH control path:

```bash
ssh -v nazar-sshuttle true
```

Check host private address and services:

```bash
ip addr show nazar-private
systemctl is-active sshd systemd-networkd nginx nixpi-bun
git ls-remote ssh://alex@git.nazar.studio/nazar/nazar.git
```
