# DAV Server MicroVM runbook

Canonical runtime: Nazar MicroVM only. Do not create alternate VM variants for DAV Server.

## Ownership

- Orchestrator repo: `/root/nazar`
- Service repo in guest: `/home/alex/dav-server`
- Guest hostname: `dav-server`
- Guest IP: `10.10.10.41`
- Private endpoint: `dav.nazar.studio` through sshuttle
- Host NixPi route: `http://nixpi.nazar.studio/` through sshuttle; select the DAV workspace there.

## State and persistence

State is declarative at the OS/service layer and persistent through MicroVM virtiofs shares declared in `nazar/nix/fleet/vms.nix`:

- `/var/lib/dav-server` from `/persist/microvms/dav-server/data`
- `/var/lib/radicale/collections` from `/persist/microvms/dav-server/radicale`
- guest SSH host keys from `/persist/microvms/dav-server/ssh`

## Deploy

From the guest for service-only edits and validation:

```bash
ssh alex@dav-server
cd ~/dav-server
nix flake check --no-build
git status
# commit and push durable changes
```

Switch production from the Nazar host after updating the `dav-server` input:

```bash
cd /root/nazar
nix flake lock --update-input dav-server
nix flake check --no-build
nix run .#switch-dav-server
```

## Lifecycle

Lifecycle is managed by the Nazar host MicroVM unit:

```bash
systemctl status microvm@dav-server
systemctl restart microvm@dav-server
journalctl -u microvm@dav-server -f
```

## Service checks

```bash
ssh alex@dav-server systemctl status nginx radicale --no-pager
curl -I http://dav.nazar.studio/files/
curl -I http://dav.nazar.studio/radicale/
```

## Policy

- Keep DAV Server as a MicroVM in the declarative Nazar fleet.
- Keep host firewall/private routing in `/root/nazar` only.
- Keep mutable DAV/Radicale state in the declared virtiofs shares.
- Do not add alternate VM builders or host-specific hardware profiles.
