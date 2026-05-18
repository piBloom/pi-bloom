# Code Runbook

`code.nazar.studio` is the private browser IDE for Nazar. It runs the native NixOS `services.openvscode-server` module on the host and is reverse-proxied by host nginx.

## Exposure model

Canonical UI:

- `http://code.nazar.studio/` -> host `127.0.0.1:4821`

This is an operator surface running as `alex`, so keep it private behind sshuttle only. `nix/modules/host/code.nix` intentionally disables the OpenVSCode connection token for mobile-friendly access and has an assertion that prevents `exposure.host.code.access = "public"`.

Private/operator hostnames resolve to `10.44.0.1` through declarative laptop `/etc/hosts` entries and are proxied by host nginx.

## Runtime shape

```text
nix/fleet/exposure.nix -> nix/modules/host/code.nix -> services.openvscode-server
                           nix/modules/host/service-proxy.nix -> nginx vhost
```

Nazar configures OpenVSCode Server with:

- backend bind: `127.0.0.1:4821`
- service unit: `openvscode-server.service`
- user/group: `alex:users`
- initial folder: `/home/alex`
- mutable state: `/home/alex/.openvscode-server/{user-data,server-data,extensions}`
- Nix/Hermes tooling in the service PATH: `hermes`, `nix`, `nil`, `nixfmt`, `git`, `ripgrep`, and common build tools

## Switch

From `/home/alex/repos/nazar` on the host:

```bash
cd /home/alex/repos/nazar
nix flake check --no-build
sudo nix --accept-flake-config build .#nixosConfigurations.nazar.config.system.build.toplevel --print-build-logs
sudo nixos-rebuild switch --flake .#nazar
```

## Validate

On the host:

```bash
systemctl is-active openvscode-server nginx
curl -I http://127.0.0.1:4821/
curl -I --resolve code.nazar.studio:80:10.44.0.1 http://code.nazar.studio/
```

From a configured sshuttle laptop:

```bash
systemctl status nazar-sshuttle
getent hosts code.nazar.studio
curl -I http://code.nazar.studio/
```

## Troubleshooting 502 Bad Gateway

A 502 from `code.nazar.studio` means host nginx is reachable but OpenVSCode Server is not reachable. Check:

```bash
systemctl status nginx openvscode-server
journalctl -u nginx -n 100 --no-pager
journalctl -u openvscode-server -n 100 --no-pager
curl -I http://127.0.0.1:4821/
```

## Rollback

```bash
sudo nixos-rebuild switch --rollback
```
