# Hermes Agent Runbook

Hermes Agent is installed through the upstream Hermes NixOS module and runs as `hermes-agent.service`.

## Runtime shape

```text
inputs.hermes-agent.nixosModules.default -> nix/modules/host/hermes-agent.nix -> services.hermes-agent
nix/modules/host/hermes-dashboard.nix -> hermes-dashboard.service -> SSH tunnel -> http://127.0.0.1:9119/
```

Nazar uses native mode with the services running as `alex`:

- agent service unit: `hermes-agent.service`
- dashboard service unit: `hermes-dashboard.service`
- laptop dashboard URL: `http://127.0.0.1:9119/`
- state directory: `/var/lib/hermes`
- managed home: `/var/lib/hermes/.hermes`
- workspace: `/var/lib/hermes/workspace`
- CLI: `hermes` is on the system PATH with `HERMES_HOME=/var/lib/hermes/.hermes`
- laptop CLI package: `alex-laptop` uses the upstream Hermes package overridden with Python `numpy` and `sounddevice` so `/voice on` can import the local audio backend in a NixOS shell
- main model/provider: `openai-codex` with `gpt-5.5`

Running the services as `alex` keeps this private single-user host simple: OAuth, repo edits, and files created by Hermes behave like normal `alex` shell sessions.

## OAuth and secrets

OpenAI Codex / ChatGPT OAuth persists in:

```text
/var/lib/hermes/.hermes/auth.json
```

Authenticate after the first rebuild:

```bash
hermes auth add openai-codex --method browser
# or use the model picker if your pinned Hermes version prefers it:
hermes model
```

Do not put API keys or OAuth JSON in Nix files. If you later need non-OAuth secrets such as an API server key, seed the optional host-local environment file:

```bash
printf 'API_SERVER_KEY=change-me\n' \
  | sudo install -m 0600 -o alex -g users /dev/stdin /var/lib/hermes/env
```

The dashboard edits `/var/lib/hermes/.hermes/.env`. Hermes reads that file on startup, so dashboard-managed API keys are picked up by new sessions or after the gateway restarts. Use `/reload` in an active Hermes CLI session to refresh environment variables without restarting that session.

## Switch

From the repository root on the host:

```bash
nix flake check --no-build
sudo nix --accept-flake-config build .#nixosConfigurations.nazar.config.system.build.toplevel --print-build-logs
sudo nixos-rebuild switch --flake .#nazar
```

Or use the repository app:

```bash
nix run .#switch-host
```

## Validate

```bash
systemctl status hermes-agent
systemctl status hermes-dashboard
journalctl -u hermes-agent -n 100 --no-pager
journalctl -u hermes-dashboard -n 100 --no-pager
hermes version
hermes config
curl -I http://127.0.0.1:9119/
```

If a fresh shell does not see the managed home, open a new login shell and confirm:

```bash
echo "$HERMES_HOME"
ls -la /var/lib/hermes/.hermes
```

## Updating Hermes

```bash
cd /etc/nixos # or this repository checkout on the host
nix flake update hermes-agent
sudo nixos-rebuild switch --flake .#nazar
```

## Rollback

```bash
sudo nixos-rebuild switch --rollback
```
