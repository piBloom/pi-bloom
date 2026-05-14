# nixpi

Nazar's private web interface for [Pi Coding Agent](https://github.com/badlogic/pi-mono).

`nixpi` is a lightweight Express/WebSocket application that spawns `pi --mode rpc` and exposes the existing Pi RPC functionality in a browser: streaming chat, session management, model switching, thinking levels, image input, command palette, session export, and optional Whisper speech-to-text.

## Why this exists

NixPi is the base web surface around Pi for Nazar and personal operator workflows. It is intended to run:

- on the `nazar` host for host-side development/operator work;
- inside each Nazar MicroVM for VM-local Pi sessions;
- behind WireGuard/private DNS only when deployed as infrastructure;
- behind a reverse-proxy subpath such as `/nixpi/` on an existing private service domain.

It deliberately reuses Pi RPC instead of replacing Pi internals.

## Quick start

```bash
npm install
NIXPI_CWD="$PWD" npm start
# open http://localhost:4815
```

Or via the CLI entry point:

```bash
npm install -g .
nixpi
```

## Configuration

| Variable         | Default   | Description                         |
| ---------------- | --------- | ----------------------------------- |
| `NIXPI_PORT`     | `4815`    | Server port                         |
| `NIXPI_HOST`     | `0.0.0.0` | Server bind address                 |
| `NIXPI_CWD`      | `$HOME`   | Working directory for Pi            |
| `NIXPI_PI_BIN`   | `pi`      | Path to Pi binary                   |
| `OPENAI_API_KEY` | unset     | Optional Whisper speech-to-text key |

## Nix/NixOS

This flake exports:

- `packages.x86_64-linux.nixpi`
- `overlays.default`
- `nixosModules.nixpi`

Example NixOS module usage:

```nix
{
  imports = [ inputs.nixpi.nixosModules.nixpi ];

  services.nixpi = {
    enable = true;
    user = "alex";
    group = "users";
    home = "/home/alex";
    workingDirectory = "/home/alex";
    host = "127.0.0.1";
    port = 4815;
    piBinary = "/run/current-system/sw/bin/pi";
  };
}
```

### Live-source mode (no rebuild per edit)

Set `sourceDir` to point at your local `nixpi` checkout. The service will run `node server.js` directly from that directory instead of the Nix store package. This lets you edit `public/index.html` (or any file) and restart the systemd unit (`systemctl restart nixpi`) without rebuilding the consumer VM.

```nix
{
  imports = [ inputs.nixpi.nixosModules.nixpi ];

  services.nixpi = {
    enable = true;
    user = "alex";
    group = "users";
    home = "/home/alex";
    workingDirectory = "/home/alex";
    sourceDir = "/home/alex/repos/nixpi";      # live checkout
    host = "0.0.0.0";
    port = 4815;
    piBinary = "/run/current-system/sw/bin/pi";
    openFirewall = true;
  };
}
```

**Requirements** for the live-source checkout:

- `node_modules/` must exist and be populated (`npm install` in the checkout).
- The `public/` directory must contain the built assets (e.g. `public/index.html`).

## Architecture

```text
Browser ←→ WebSocket ←→ nixpi (Express) ←→ Pi (`pi --mode rpc`)
```

NixPi keeps state in the normal Pi session directory for the configured `HOME` and `NIXPI_CWD`. It does not require browser-held provider secrets; Pi uses its local configuration.

## Reverse proxy paths

NixPi supports being served at the root of a private name, for example `http://nixpi.nazar.studio/`, or under `/nixpi/` on an existing private service domain, for example `http://git.nazar.studio/nixpi/`. When served under `/nixpi/`, configure the proxy to strip the prefix before forwarding to the NixPi service and preserve WebSocket upgrades.

## Development checks

```bash
npm install
node --check server.js
nix flake check --no-build
```

## License

[MIT](LICENSE). NixPi is derived from the original `wgnr-pi` MIT project; original copyright notices are preserved in the license.
