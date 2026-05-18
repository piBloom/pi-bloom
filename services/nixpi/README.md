# nixpi-bun

Experimental Bun-native private web interface for [Pi Coding Agent](https://github.com/badlogic/pi-mono), used by Nazar as the private operator surface.

`nixpi-bun` keeps a thin Pi RPC bridge and runs on Bun's native HTTP/WebSocket runtime. It spawns `pi --mode rpc` and exposes streaming chat, session management, model switching, thinking levels, image input, command palette, session export, and optional Whisper speech-to-text.

## Status

This directory owns the NixPi source, reusable NixOS module, and package expression. The Nazar root flake imports those files directly and exposes the package as `.#nixpi-bun`; there is no service-local flake.

The runtime app has no npm dependencies. Markdown rendering uses a small native safe subset rather than loading parser/sanitizer packages.

## Production shape

- Root package: `nix build .#nixpi-bun` from the repository root.
- Root module import: `nix/modules/host/nixpi.nix` imports `services/nixpi/nix/modules/nixpi-bun.nix`.
- Systemd unit: `nixpi-bun.service`.
- Backend bind: `127.0.0.1:4815`.
- Private route: `http://nixpi.nazar.studio/` through sshuttle and host nginx.

## Quick start

From the repository root:

```bash
nix develop .#nixpi
cd services/nixpi
NIXPI_CWD="$PWD" bun server.js
# open http://localhost:4815 unless NIXPI_PORT is set
```

Or via the package:

```bash
nix run .#nixpi-bun
```

## Configuration

| Variable         | Default   | Description                                |
| ---------------- | --------- | ------------------------------------------ |
| `NIXPI_PORT`     | `4815`    | Server port (`4816` in the module default) |
| `NIXPI_HOST`     | `0.0.0.0` | Server bind address                        |
| `NIXPI_CWD`      | `$HOME`   | Working directory for Pi                   |
| `NIXPI_PI_BIN`   | `pi`      | Path to Pi binary                          |
| `OPENAI_API_KEY` | unset     | Optional Whisper speech-to-text key        |

## NixOS module

The reusable module lives at `services/nixpi/nix/modules/nixpi-bun.nix` and is exported by the root flake as `nixosModules.nixpi-bun` / `nixosModules.nixpi-bun-service`.

Example usage inside this repository:

```nix
{
  imports = [ ../../../services/nixpi/nix/modules/nixpi-bun.nix ];

  services.nixpi-bun = {
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

### Live-source mode

Set `sourceDir` to point at a local checkout. The service will run `bun server.js` directly from that directory instead of the Nix store package, so you can edit static assets or server code and restart `nixpi-bun.service` without rebuilding.

## Architecture

```text
Browser ←→ WebSocket ←→ nixpi-bun (Bun.serve) ←→ Pi (`pi --mode rpc`)
```

NixPi Bun keeps state in the normal Pi session directory for the configured `HOME` and `NIXPI_CWD`. It does not require browser-held provider secrets; Pi uses its local configuration.

## Reverse proxy paths

NixPi Bun supports being served at the root of a private name, for example `http://nixpi.nazar.studio/`. Dedicated private hostnames are preferred for Nazar production because WebSocket routing stays simple.

## Development checks

From the repository root:

```bash
nix develop .#nixpi --command make -C services/nixpi check
nix build .#nixpi-bun --no-link
```

From this directory inside `nix develop ../..#nixpi`:

```bash
make check
make build
```

## License

[MIT](LICENSE). NixPi Bun is derived from NixPi and the original `wgnr-pi` MIT project; original copyright notices are preserved in the license.
