# NixPI Signal Gateway

A small TypeScript gateway that connects a dedicated Signal bot number to Pi using the Pi SDK.

This repo-owned copy is the **canonical source** for the gateway code.

## What belongs in git

- `src/`
- `bin/`
- `systemd/user/`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `signal-gateway.example.yml`
- this README

## What must stay out of git

- the real gateway config
- linked Signal account data
- SQLite state
- logs, pidfiles, QR images, temporary link artifacts
- `node_modules/`
- `dist/`

Concretely, do **not** commit:

- `signal-gateway.yml`
- `signal-cli-data/`
- `state/`
- `tmp/`

## Architecture

- `signal-cli` daemon provides native HTTP + SSE transport
- this gateway handles auth, dedupe, routing, and formatting
- Pi SDK provides one persistent session per Signal chat

## Native signal-cli endpoints used

- `GET /api/v1/check`
- `GET /api/v1/events`
- `POST /api/v1/rpc`

## v1 behavior

- direct messages only
- text messages only
- allowlist-based access
- one Pi session per Signal chat
- sync, receipt, typing, and other control events ignored
- concise plain-text replies with chunking for long output

## Recommended local layout

Code lives here in the repo.

Runtime data should live outside the repo, preferably under XDG paths:

- config: `${XDG_CONFIG_HOME:-~/.config}/nixpi-signal-gateway/config.yml`
- state: `${XDG_STATE_HOME:-~/.local/state}/nixpi-signal-gateway/`
  - `gateway.db`
  - `pi-sessions/`
  - `signal-cli-data/`
  - `tmp/`

## Development

```bash
cd /var/lib/nixpi/pi-nixpi/Agents/signal-gateway
npm install
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/nixpi-signal-gateway"
cp signal-gateway.example.yml "${XDG_CONFIG_HOME:-$HOME/.config}/nixpi-signal-gateway/config.yml"
npm run dev -- "${XDG_CONFIG_HOME:-$HOME/.config}/nixpi-signal-gateway/config.yml"
```

## Build

```bash
cd /var/lib/nixpi/pi-nixpi/Agents/signal-gateway
npm run build
```

## Manual helper scripts

The helper scripts derive the repo path automatically.

Common environment overrides:

- `SIGNAL_GATEWAY_CONFIG` — path to the real config file
- `SIGNAL_GATEWAY_STATE_DIR` — base runtime state dir
- `SIGNAL_CLI_BIN` — path to `signal-cli`
- `SIGNAL_CLI_CONFIG_DIR` — linked Signal account dir
- `SIGNAL_ACCOUNT` — Signal account number if not read from config

Examples:

```bash
export SIGNAL_GATEWAY_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/nixpi-signal-gateway/config.yml"
export SIGNAL_GATEWAY_STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/nixpi-signal-gateway"
```

Start signal-cli daemon:

```bash
/var/lib/nixpi/pi-nixpi/Agents/signal-gateway/bin/start-signal-daemon
```

Start gateway:

```bash
/var/lib/nixpi/pi-nixpi/Agents/signal-gateway/bin/start-gateway
```

Useful helpers:

```bash
/var/lib/nixpi/pi-nixpi/Agents/signal-gateway/bin/status
/var/lib/nixpi/pi-nixpi/Agents/signal-gateway/bin/restart-all
/var/lib/nixpi/pi-nixpi/Agents/signal-gateway/bin/stop-gateway
/var/lib/nixpi/pi-nixpi/Agents/signal-gateway/bin/stop-signal-daemon
```

## systemd user units

Template unit files live in:

- `systemd/user/nixpi-signal-daemon.service`
- `systemd/user/nixpi-signal-gateway.service`

Install them into your user systemd directory with environment-specific path substitution:

```bash
export SIGNAL_GATEWAY_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/nixpi-signal-gateway/config.yml"
export SIGNAL_GATEWAY_STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/nixpi-signal-gateway"
/var/lib/nixpi/pi-nixpi/Agents/signal-gateway/bin/install-systemd-user-units
```

Then enable and start them:

```bash
systemctl --user enable --now nixpi-signal-daemon.service
systemctl --user enable --now nixpi-signal-gateway.service
```

Useful commands:

```bash
systemctl --user status nixpi-signal-daemon.service
systemctl --user status nixpi-signal-gateway.service
journalctl --user -u nixpi-signal-daemon.service -f
journalctl --user -u nixpi-signal-gateway.service -f
```

To keep user services running after logout:

```bash
sudo loginctl enable-linger "$USER"
```

To remove the installed user units:

```bash
/var/lib/nixpi/pi-nixpi/Agents/signal-gateway/bin/uninstall-systemd-user-units
```

## Migrating from the old local-only tree

If your live gateway is still under `~/nixpi/Agents/signal-gateway`, keep using its existing runtime data for now.

Suggested migration:

1. copy `signal-gateway.example.yml` to your XDG config path
2. update the config to point at your desired runtime state dir
3. point the installed user units at the repo-owned scripts via `bin/install-systemd-user-units`
4. keep your existing `signal-cli-data/` and `state/` outside git
5. once the repo-owned version is running cleanly, retire the old code directory

## Built-in chat commands

- `help`
- `reset`

Everything else is forwarded to Pi.
