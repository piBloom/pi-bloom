# DAV Server VM Runbook

`dav-server` is the private personal data VM for Nazar.

- VM: `dav-server`
- Private DNS: `dav.nazar.studio` -> `10.44.0.1` from WireGuard dnsmasq
- VM NAT IP: `10.10.10.41`
- State: `/persist/microvms/dav-server`
- Guest data: `/var/lib/dav-server`, `/var/lib/radicale/collections`
- Services: nginx WebDAV at `/files/`, Radicale CalDAV/CardDAV at `/radicale/`
- Exposure: WireGuard-private through the host nginx proxy; no public DNS or public port forward

DAV Server uses the configured htpasswd file for nginx basic auth on `/files/` and `/radicale/`. WireGuard peers are still network-trusted; do not onboard broad/untrusted peers until DAV secrets, backups, and restore paths are validated.

## Fresh-server policy

Start this as a fresh `dav-server` state tree. Do not copy or bind-mount old `/persist/microvms/dav` or guest `/var/lib/dav` data into this VM unless a separate migration plan is explicitly approved. Provision new secrets under `/persist/microvms/dav-server` / `/var/lib/dav-server` and validate auth, backups, and restore before storing real personal data.

Build/deploy:

```bash
nix build .#dav-server-qcow2
nix run .#deploy-dav-server
```

Validation from a WireGuard client:

```bash
dig @10.44.0.1 dav.nazar.studio +short
curl -I http://dav.nazar.studio/
```

Do not expose DAV publicly without an explicit hardening pass covering auth, TLS, backups, logging, and rollback.
