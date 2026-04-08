# Quick Deploy

> Bootstrap NixPI onto a VPS, headless VM, or mini PC and operate it from the Pi terminal surface

## Audience

Operators and maintainers deploying NixPI onto a NixOS-capable x86_64 VPS, headless VM, or mini PC.

## Security Note: WireGuard Is the Remote-Access Boundary

WireGuard is the network security boundary for NixPI services. The firewall trusts only the WireGuard interface (`wg0`) for app traffic, while SSH remains separately controlled.

**Complete WireGuard peer setup and verify `wg0` is active before treating the deployment as ready for normal use.** See [Security Model](../reference/security-model) for the full threat model.

## Canonical Deployment Path

NixPI is bootstrap-first and remote-first. The standard public deployment flow is:

1. provision a NixOS-capable x86_64 machine
2. run the bootstrap command once
3. open the browser Pi terminal
4. keep operating from the canonical checkout at `/srv/nixpi`

## 1. Provision a NixOS-Capable Machine

Bring up a fresh x86_64 VPS, headless VM, or mini PC with:

- SSH access
- `sudo` privileges
- outbound internet access
- enough disk and RAM to complete a `nixos-rebuild switch`

If you are evaluating changes locally, a headless NixOS VM is fine. If you are deploying to a mini PC, an attached monitor is useful as a local fallback, but the supported install path is still the same bootstrap command.

## 2. Run the Bootstrap Command

From the target host:

```bash
nix run github:alexradunet/nixpi#nixpi-bootstrap-vps
```

If you already have a local checkout of this branch, you can use the repo-local command instead:

```bash
nix run .#nixpi-bootstrap-vps
```

The bootstrap package:

- clones the repo into `/srv/nixpi` if it does not exist
- refreshes that checkout from `origin/main`
- initializes a standard flake-based `/etc/nixos`
- runs `sudo nixos-rebuild switch --flake /etc/nixos#nixos`

`/etc/nixos` remains the standard system layer for hardware, boot, filesystems, display, and desktop settings. `/srv/nixpi` provides the NixPI layer imported by that system flake, so rebuilds preserve machine-specific behavior instead of replacing it. The generated flake keeps the normal `configuration.nix` entrypoint and exposes a single `#nixos` target.

The generated system flake also follows the configured stable NixOS line by default. Today that means `nixos-25.11`, which prevents bootstrap from silently jumping onto `nixos-unstable` or a 26.x pre-release line while NixPI is layered on top.

On monitor-attached hardware, the resulting system keeps a `tty1` login prompt after reboot. The browser Pi terminal remains the primary operator surface; the monitor is a recovery path.

> Warning: rerunning the bootstrap command on a host with local commits in `/srv/nixpi` will reset that checkout to `origin/main`. Commit or export local work first.

## 3. Connect to the Pi Terminal

After the switch completes, NixPI runs as a remote-first service set. The default operator surface is the Pi terminal exposed through the browser:

- `/` — primary Pi terminal surface
- `/terminal/` — alias to the same ttyd session

Preferred access is over WireGuard. In practice that means:

1. add your admin device as a WireGuard peer
2. confirm `wireguard-wg0.service` is active
3. verify the `wg0` interface exists
4. open the Pi terminal over the WireGuard-reachable host IP

Useful checks:

```bash
systemctl status wireguard-wg0.service
wg show wg0
ip link show wg0
```

## 4. Operate from `/srv/nixpi`

Treat `/srv/nixpi` as the installed source of truth. Use it for edits, sync, and rebuilds.

```bash
cd /srv/nixpi
sudo nixpi-rebuild
```

To update the canonical checkout and rebuild in one command:

```bash
sudo nixpi-rebuild-pull
sudo nixpi-rebuild-pull main
```

Roll back if needed:

```bash
sudo nixos-rebuild switch --rollback
```

## 5. Validate the Headless Surface

Smoke-check the core services on a running host:

```bash
systemctl status nixpi-ttyd.service
systemctl status nginx.service

# Public surface through nginx
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/terminal/
```

Expected result:

- `/` responds from the Pi terminal surface
- `/terminal/` responds as an alias to the same ttyd session

For repo-side validation during development:

```bash
nix --option substituters https://cache.nixos.org/ build .#checks.x86_64-linux.config --no-link
nix build .#checks.x86_64-linux.nixpi-vps-bootstrap --no-link -L
```

## Related

- [First Boot Setup](./first-boot-setup)
- [Install NixPI](../install)
- [Security Model](../reference/security-model)
