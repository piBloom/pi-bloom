# Nazar

Declarative NixOS configuration for the Hetzner host `nazar`, a client laptop profile, host services, and service source code.

## Scope

The canonical local checkout on the Nazar VPS is:

```text
/home/alex/repos/nazar
```

This repository has one production Nix surface: the root `flake.nix`. The host and laptop configurations import modules directly from `nix/modules`.

The root flake owns deployment, SSH-only operator access, the Hermes services, operator switch apps, and the Hermes Agent NixOS module wiring.

## Services

- Host Hermes Agent: `hermes-agent.service` managed declaratively by NixOS; use `hermes` from SSH.
- Nazar App Directory: `http://nazar.ojos-sargas.ts.net:8080/` over Tailscale, backed by Nginx static HTML.
- Hermes Dashboard: `http://127.0.0.1:9119/` through the laptop SSH tunnel, backed by `hermes-dashboard.service`.
- Tailscale private access: `tailscaled.service` joins Nazar to a tailnet so phone/desktop apps can reach future private CalDAV/WebDAV endpoints without public HTTP exposure.

## Repository map

```text
flake.nix                     # root flake: configs, modules, packages, checks, apps
nix/hosts/nazar/              # production host composition, hardware, and disk layout
nix/hosts/alex-laptop/        # client/laptop composition and hardware config
nix/modules/host/             # host baseline, networking, service adapters, monitoring
nix/modules/laptop/           # client-side access modules
nix/modules/guest/            # shared guest VM helpers
nix/fleet/                    # host identity and exposure policy
runbooks/                     # operational notes
```

## Common commands

```bash
cd /home/alex/repos/nazar
nix flake check
nix fmt
nix run .#switch-host
```

## Development commands

```bash
nix build .#hermes-agent
```

## Quick health checks

```bash
systemctl is-active sshd systemd-networkd hermes-agent hermes-dashboard nginx
systemctl status nazar-tunnel
curl -I http://nazar.ojos-sargas.ts.net:8080/
curl -I http://127.0.0.1:9119/
```

## Policy

- Keep deployment authority in the root flake.
- Treat `/home/alex/repos/nazar` as the only canonical local checkout on the VPS.
- Keep admin browser services bound to host loopback and reachable through SSH local forwarding; expose simple directory/static views only on explicitly allowed Tailscale ports.
- Keep CalDAV/WebDAV and other personal-data sync endpoints private-first; prefer explicit `tailscale0` firewall exposure over public HTTP exposure.
- Keep Hermes configured through NixOS and secrets files, not ad-hoc host services.
- Keep service code in `services/`, but compose production from the root host configuration.
- Prefer explicit direct imports over generated module discovery or wrapper layers.
