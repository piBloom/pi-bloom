---
name: dufs
version: 0.1.0
description: Minimal WebDAV file server for dedicated Bloom share access over NetBird mesh
image: docker.io/sigoden/dufs:v0.38.0
---

# dufs Service

Lightweight WebDAV file server exposing `~/Public/Bloom`. Accessible from any device on your NetBird mesh network.

## Access

WebDAV endpoint: `http://<bloom-device>:5000`
- Requires NetBird mesh connectivity
- No authentication — NetBird provides the access control

## Client Setup

### Windows
Map network drive: `\\<bloom-device>@5000\DavWWWRoot`

### Linux
Mount: `sudo mount -t davfs http://<bloom-device>:5000 /mnt/bloom`
Or use your file manager's "Connect to Server" feature.

### Android
Use FolderSync, Solid Explorer, or any WebDAV-capable file manager.

### macOS
Finder > Go > Connect to Server > `http://<bloom-device>:5000`

## Service Control

```bash
systemctl --user start bloom-dufs.service
systemctl --user status bloom-dufs
journalctl --user -u bloom-dufs -f
```

## Notes

- Only accessible via NetBird mesh — not exposed to the public internet
- Serves only `~/Public/Bloom` (read/write)
- Use this directory as the intentional cross-device share, not as a general remote home mount
- Swappable with rclone (`rclone serve webdav`) or Syncthing
