# Nazar integration plan

NixPi should be integrated into Nazar as a private, WireGuard-only Pi web surface.

## Constraints from Nazar runbooks

- Private services stay behind WireGuard and host nginx on `10.44.0.1`.
- Do not publish public DNS or public HTTP for NixPi endpoints.
- The `nazar` host owns VM lifecycle, VMID/IP/MAC, NAT/firewall, WireGuard peers, and public exposure.
- Each MicroVM may run VM-local Pi/NixPi against its own working directory, but host/fleet changes still require human review in the `nazar` repo.
- DAV data remains isolated in `dav-server`; NixPi should not co-locate DAV state or secrets.

## Recommended production shape

1. Publish this repo to Forgejo as `ssh://git@git.nazar.studio:10022/nazar/nixpi.git`.
2. Add it to `nazar/flake.nix`:

   ```nix
   nixpi = {
     url = "git+ssh://git@git.nazar.studio:10022/nazar/nixpi.git";
     inputs.nixpkgs.follows = "nixpkgs";
   };
   ```

3. Import `inputs.nixpi.nixosModules.nixpi` on the `nazar` host and in the common MicroVM baseline.
4. Run one `nixpi` service per machine as `alex`, with `NIXPI_PI_BIN` pointed at the pinned Pi package and `NIXPI_CWD` set to that machine's local repo/root.
5. Persist Pi/NixPi session state intentionally. For MicroVMs, prefer a per-VM virtiofs share mounted at `/home/alex/.pi` (or another explicit HOME) so browser sessions, model settings, and Pi config survive VM recreation.
6. Bind the host service to `127.0.0.1:4815` and proxy it from host nginx on WireGuard only.
7. Bind MicroVM services to `0.0.0.0:4815`, firewall them to the MicroVM bridge gateway (`10.10.10.1`) only, and proxy through host nginx.

## Suggested routing

Primary per-service routes should use `/nixpi/` on every VM service domain/alias:

- `git.nazar.studio/nixpi/` -> `git` VM NixPi
- `balaur.eu/nixpi/` and `balaur.nazar.studio/nixpi/` -> `minecraft` VM NixPi over WireGuard DNS
- `ownloom.nazar.studio/nixpi/` -> `ownloom` VM NixPi
- `dav.nazar.studio/nixpi/` -> `dav-server` VM NixPi

Dedicated private names can also be kept for direct access:

- `nixpi.nazar.studio` -> host `nazar`
- `nixpi-git.nazar.studio` -> `git` VM
- `nixpi-minecraft.nazar.studio` -> `minecraft` VM
- `nixpi-ownloom.nazar.studio` -> `ownloom` VM
- `nixpi-dav-server.nazar.studio` -> `dav-server` VM

All dedicated records should resolve to `10.44.0.1` from dnsmasq on WireGuard and should not exist in public DNS. Service domains that also have public DNS, such as `balaur.eu`, can be overridden by WireGuard dnsmasq for private HTTP/operator paths.

## Declarative exposure

Nazar keeps HTTP exposure policy in `nix/fleet/exposure.nix`. A route with `access = "wireguard"` is only served on the WireGuard listener. A route with `access = "public"` is also served on the public IPv4 listener and opens TCP/80. Keep NixPi WireGuard-only unless a separate auth/hardening review happens. Future routes such as `/subagent/` should be enabled by adding a route in that exposure file rather than ad-hoc nginx edits.

## Security stance

NixPi is an operator surface: it can drive Pi tools as `alex` in the configured working directory. Until NixPi has service-level authentication/authorization, keep it available only to a small trusted WireGuard peer set.

## Validation checklist

From `/root/nazar` after the input is locked:

```bash
nix flake check --no-build
nix run .#deploy-git
nix run .#deploy-minecraft
nix run .#deploy-ownloom
nix run .#deploy-dav-server
```

From a WireGuard client:

```bash
dig @10.44.0.1 nixpi.nazar.studio +short
curl -I http://git.nazar.studio/nixpi/
curl -I http://balaur.nazar.studio/nixpi/
curl -I http://ownloom.nazar.studio/nixpi/
curl -I http://nixpi.nazar.studio/
curl -I http://nixpi-ownloom.nazar.studio/
```

Inside a VM:

```bash
systemctl status nixpi
curl -I http://127.0.0.1:4815/
```
