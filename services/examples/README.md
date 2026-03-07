# Service reference examples

This folder contains worked reference packages for Bloom service lifecycle patterns.

## Included examples

- `demo-api/`
  - Standard non-socket service package
  - Uses `PublishPort` pattern

- `demo-socket-echo/`
  - Socket-activated reference package
  - Demonstrates `.socket` + `.container` pairing

## Quickstart (copy/paste)

### 1) Standard example: `demo-api`

```bash
mkdir -p ~/.config/containers/systemd
cp services/examples/demo-api/quadlet/* ~/.config/containers/systemd/
mkdir -p ~/Bloom/Skills/demo-api
cp services/examples/demo-api/SKILL.md ~/Bloom/Skills/demo-api/SKILL.md
systemctl --user daemon-reload
systemctl --user start bloom-demo-api.service
systemctl --user status bloom-demo-api --no-pager
curl -s http://localhost:9080
```

### 2) Socket reference: `demo-socket-echo`

```bash
mkdir -p ~/.config/containers/systemd ~/.config/systemd/user
cp services/examples/demo-socket-echo/quadlet/bloom-demo-socket-echo.container ~/.config/containers/systemd/
cp services/examples/demo-socket-echo/quadlet/bloom-demo-socket-echo.socket ~/.config/systemd/user/
mkdir -p ~/Bloom/Skills/demo-socket-echo
cp services/examples/demo-socket-echo/SKILL.md ~/Bloom/Skills/demo-socket-echo/SKILL.md
systemctl --user daemon-reload
systemctl --user start bloom-demo-socket-echo.socket
systemctl --user status bloom-demo-socket-echo.socket --no-pager
```

## Cleanup / Uninstall (copy/paste)

Run after testing to remove demo services:

```bash
systemctl --user stop bloom-demo-api.service 2>/dev/null || true
systemctl --user stop bloom-demo-socket-echo.socket 2>/dev/null || true
systemctl --user stop bloom-demo-socket-echo.service 2>/dev/null || true
rm -f ~/.config/containers/systemd/bloom-demo-api.container
rm -f ~/.config/containers/systemd/bloom-demo-socket-echo.container
rm -f ~/.config/systemd/user/bloom-demo-socket-echo.socket
rm -rf ~/Bloom/Skills/demo-api
rm -rf ~/Bloom/Skills/demo-socket-echo
systemctl --user daemon-reload
```

## Production reference

For a real in-tree socket-activated service, see:

- `../whisper/quadlet/`
