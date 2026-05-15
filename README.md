# nixpi-bun

Experimental Bun-native fork of Nazar's private web interface for [Pi Coding Agent](https://github.com/badlogic/pi-mono).

`nixpi-bun` keeps the same thin Pi RPC bridge as `nixpi`, but replaces the Node/Express/`ws` server with Bun's native HTTP and WebSocket runtime. It spawns `pi --mode rpc` and exposes the existing Pi RPC functionality in a browser: streaming chat, session management, model switching, thinking levels, image input, command palette, session export, and optional Whisper speech-to-text.

## Status

This repository is the comparison track. Keep the original `nixpi` repository as the boring production baseline while this fork proves Bun runtime, Nix packaging, and UI simplification choices.

Current dependency note: the runtime app has no npm dependencies. Markdown rendering uses a small native safe subset rather than loading parser/sanitizer packages.

## Why this exists

NixPi Bun is the experimental comparison repo for a more native NixOS + Bun appliance shape. It is intended to run:

- on the `nazar` host for host-side development/operator work;
- inside each Nazar MicroVM for VM-local Pi sessions;
- behind WireGuard/private DNS only when deployed as infrastructure;
- behind a reverse-proxy subpath such as `/nixpi/` on an existing private service domain.

It deliberately reuses Pi RPC instead of replacing Pi internals.

## Quick start

```bash
nix develop
NIXPI_CWD="$PWD" bun server.js
# open http://localhost:4815 unless NIXPI_PORT is set
```

Or via the CLI entry point:

```bash
bun install -g .
nixpi-bun
```

## Configuration

| Variable         | Default   | Description                              |
| ---------------- | --------- | ---------------------------------------- |
| `NIXPI_PORT`     | `4815`    | Server port (`4816` in the NixOS module) |
| `NIXPI_HOST`     | `0.0.0.0` | Server bind address                      |
| `NIXPI_CWD`      | `$HOME`   | Working directory for Pi                 |
| `NIXPI_PI_BIN`   | `pi`      | Path to Pi binary                        |
| `OPENAI_API_KEY` | unset     | Optional Whisper speech-to-text key      |

## Nix/NixOS

This flake exports:

- `packages.x86_64-linux.nixpi-bun`
- `overlays.default`
- `nixosModules.nixpi-bun`

Example NixOS module usage:

```nix
{
  imports = [ inputs.nixpi-bun.nixosModules.nixpi-bun ];

  services.nixpi-bun = {
    enable = true;
    user = "alex";
    group = "users";
    home = "/home/alex";
    workingDirectory = "/home/alex";
    host = "127.0.0.1";
    port = 4816;
    piBinary = "/run/current-system/sw/bin/pi";
  };
}
```

### Live-source mode

Set `sourceDir` to point at your local `nixpi-bun` checkout. The service will run `bun server.js` directly from that directory instead of the Nix store package. This lets you edit `public/index.html` or server code and restart the systemd unit (`systemctl restart nixpi-bun`) without rebuilding the consumer VM.

```nix
{
  imports = [ inputs.nixpi-bun.nixosModules.nixpi-bun ];

  services.nixpi-bun = {
    enable = true;
    user = "alex";
    group = "users";
    home = "/home/alex";
    workingDirectory = "/home/alex";
    sourceDir = "/home/alex/repos/nixpi-bun";
    host = "0.0.0.0";
    port = 4816;
    piBinary = "/run/current-system/sw/bin/pi";
    openFirewall = true;
  };
}
```

**Requirements** for live-source mode:

- The `public/` directory must contain the static assets.
- No `node_modules/` directory is required for the runtime app.

## Architecture

```text
Browser ←→ WebSocket ←→ nixpi-bun (Bun.serve) ←→ Pi (`pi --mode rpc`)
```

NixPi Bun keeps state in the normal Pi session directory for the configured `HOME` and `NIXPI_CWD`. It does not require browser-held provider secrets; Pi uses its local configuration.

## Reverse proxy paths

NixPi Bun supports being served at the root of a private name, for example `http://nixpi-bun.nazar.studio/`, or under `/nixpi/` on an existing private service domain, for example `http://git.nazar.studio/nixpi/`. When served under `/nixpi/`, configure the proxy to strip the prefix before forwarding to the NixPi Bun service and preserve WebSocket upgrades.

## Development checks

```bash
nix develop
make smoke
nix build .#nixpi-bun --no-link
```

## License

[MIT](LICENSE). NixPi Bun is derived from NixPi and the original `wgnr-pi` MIT project; original copyright notices are preserved in the license.
