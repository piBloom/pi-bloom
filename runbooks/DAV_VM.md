# DAV VM Runbook

`dav` is the private personal data VM for Nazar.

- VM: `dav`
- Private DNS: `dav.nazar.studio` -> `10.44.0.1` from WireGuard dnsmasq
- VM NAT IP: `10.10.10.41`
- State: `/persist/microvms/dav`
- Guest data: `/var/lib/dav`, `/var/lib/radicale/collections`
- Services: nginx WebDAV at `/files/`, Radicale CalDAV/CardDAV at `/radicale/`
- Exposure: WireGuard-private through the host nginx proxy; no public DNS or public port forward

DAV uses the configured htpasswd file for nginx basic auth on `/files/` and `/radicale/`. WireGuard peers are still network-trusted; do not onboard broad/untrusted peers until DAV secrets, backups, and restore paths are validated.

Build/deploy:

```bash
nix build .#dav-qcow2
nix run .#deploy-dav
```

Validation from a WireGuard client:

```bash
dig @10.44.0.1 dav.nazar.studio +short
curl -I http://dav.nazar.studio/
```

Do not expose DAV publicly without an explicit hardening pass covering auth, TLS, backups, logging, and rollback.
