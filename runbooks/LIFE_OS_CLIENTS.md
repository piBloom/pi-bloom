# Life OS Clients

This runbook describes how NixOS laptops and future clients consume Life OS over the private Tailscale network.

## Design

Life OS data lives on Nazar under `/srv/life`. Nazar exposes two private DAV services to Tailscale clients:

```text
WebDAV files/Markdown:      http://100.92.138.94/life/
Radicale CalDAV/CardDAV:   http://100.92.138.94:5232/
```

Both endpoints are intended for Tailscale clients only:

- TCP/80 is allowed on `tailscale0` for the Nginx WebDAV endpoint.
- TCP/5232 is allowed on `tailscale0` for Radicale.
- Public/global firewall exposure for those services stays blocked.

Client machines enable `nazar.lifeOs.client`, which provides:

- Tailscale dependency assertions.
- `davfs2` support.
- A lazy WebDAV automount at `/home/alex/LifeOS`.
- Obsidian for browsing the mounted Markdown/filesystem view.
- `services.vdirsyncer` for declarative CalDAV/CardDAV sync.
- CLI consumers: `khal` for calendars, `todoman` for VTODO tasks/reminders, and `khard` for contacts.
- Human GUI clients: KDE PIM apps and Thunderbird.

## Declarative app choice

The declarative NixOS split is:

| Need | Tool | Declarative status |
| --- | --- | --- |
| Server CalDAV/CardDAV | `services.radicale` | Native NixOS module |
| Server WebDAV files | Nginx DAV module | Native NixOS config |
| Laptop WebDAV mount | `services.davfs2` + `fileSystems` | Native NixOS config |
| Laptop DAV sync | `services.vdirsyncer` | Native NixOS module |
| Laptop CLI calendar | `khal` | Package + declarative XDG config |
| Laptop CLI contacts | `khard` | Package + declarative XDG config |
| Laptop CLI tasks/reminders | `todoman` | Package + declarative XDG config |
| Laptop GUI calendar/contact/task | KDE PIM / Thunderbird | Declarative install; account state may still require UI confirmation |
| Laptop notes/journal UI | Obsidian | Declarative install; vault is `/home/alex/LifeOS` |

KDE Akonadi and Thunderbird account internals are user-session state, not clean stable NixOS options. The clean declarative layer is therefore Radicale + vdirsyncer + local vdir stores, with GUI clients installed as human-friendly consumers/debuggers.

## Enable on a NixOS client

Import the shared modules from the host configuration:

```nix
{
  imports = [
    ../../modules/laptop/tailscale.nix
    ../../modules/laptop/life-os-client.nix
  ];

  nazar.lifeOs.client = {
    enable = true;
    davUrl = "http://100.92.138.94/life/";
    caldav.url = "http://100.92.138.94:5232/";
  };
}
```

The module intentionally keeps Tailscale in client mode. Do not enable subnet routing or exit-node behavior unless it is explicitly designed and reviewed.

## Rebuild

From the client checkout:

```bash
cd /home/alex/repos/nazar
sudo nixos-rebuild switch --flake .#alex-laptop
```

On Nazar:

```bash
cd /home/alex/repos/nazar
sudo nixos-rebuild switch --flake .#nazar
```

## Tailscale enrollment

If the client has not joined the tailnet yet:

```bash
sudo tailscale up --hostname=alex-laptop --ssh=false
```

Verify:

```bash
systemctl is-active tailscaled
sudo tailscale status
sudo tailscale ip -4
ping 100.92.138.94
```

Future clients can use `services.tailscale.authKeyFile` for declarative auto-enrollment, but the auth key must be supplied by a runtime secret mechanism such as agenix or sops-nix, never directly in Nix.

## WebDAV mount verification

The client mount is lazy. Accessing the path should trigger the mount:

```bash
systemctl status home-alex-LifeOS.automount --no-pager -l
ls -la /home/alex/LifeOS
findmnt /home/alex/LifeOS
```

Expected `findmnt` result:

```text
/home/alex/LifeOS ... davfs ...
```

If the mount fails, inspect:

```bash
journalctl -u home-alex-LifeOS.mount --no-pager -l
journalctl -u home-alex-LifeOS.automount --no-pager -l
curl -I http://100.92.138.94/life/
```

## Radicale verification

From the laptop, Radicale should be reachable over Tailscale:

```bash
curl -I http://100.92.138.94:5232/
curl -X PROPFIND -H 'Depth: 0' -i http://100.92.138.94:5232/
```

Expected result: Radicale responds on TCP/5232. `PROPFIND` should not be a generic Nginx `/life/` response.

Service checks on Nazar:

```bash
systemctl status radicale --no-pager -l
ss -ltnp | grep 5232
```

## vdirsyncer verification

The laptop has a declarative `services.vdirsyncer.jobs.life-os` job and timer.

```bash
systemctl status 'vdirsyncer@life-os.timer' --no-pager -l
systemctl start 'vdirsyncer@life-os.service'
journalctl -u 'vdirsyncer@life-os.service' --no-pager -l
```

Local sync directories:

```text
/home/alex/.local/share/life-os/calendars
/home/alex/.local/share/life-os/contacts
```

CLI consumers:

```bash
khal list today 7d
todo list
khard list
```

## Desktop use

### Obsidian

Open Obsidian and use one of these as a vault depending on how you want to browse the data:

```text
/home/alex/LifeOS
/home/alex/LifeOS/notes
```

For now this is a direct WebDAV-backed mount. If Obsidian becomes slow or has file-locking issues, switch the module later to local sync instead of direct mount.

### KDE PIM

Use KOrganizer, KAddressBook, Kontact, or Merkuro for human calendar/contact/task UI.

Radicale URL:

```text
http://100.92.138.94:5232/
```

The GUI apps are installed declaratively, but KDE Akonadi DAV account provisioning is not currently generated declaratively because it is user-session state. If the local vdirsyncer/CLI layer works but KDE does not auto-detect accounts, add the DAV source manually in KDE using the Radicale URL above.

### Thunderbird

Thunderbird is installed as a reliable CalDAV/CardDAV client and debugging fallback.

Use the Radicale URL:

```text
http://100.92.138.94:5232/
```

Do not point Thunderbird calendar/address-book setup at the generic WebDAV `/life/` endpoint.

## Protocol verification

From the laptop, generic WebDAV is healthy if these checks pass:

```bash
curl -I http://100.92.138.94/life/
curl -X OPTIONS -i http://100.92.138.94/life/
curl -X PROPFIND -H 'Depth: 0' -i http://100.92.138.94/life/
```

Expected WebDAV result: `PROPFIND` returns `207 Multi-Status`.

CalDAV/CardDAV is served separately by Radicale:

```bash
curl -I http://100.92.138.94:5232/
curl -X PROPFIND -H 'Depth: 0' -i http://100.92.138.94:5232/
```

## Security notes

- The WebDAV and Radicale endpoints are private-by-network: reachable through Tailscale, not public internet.
- Do not expose TCP/80, TCP/443, or TCP/5232 globally just to make DAV work.
- Do not put DAV credentials, Tailscale auth keys, OAuth tokens, or private certificates into Nix expressions.
- Radicale currently uses Tailscale-only access without app-level credentials to keep secrets out of the Nix store. If app-level authentication is needed later, switch Radicale to `htpasswd` and provide the password file via a runtime secret mechanism such as agenix/sops-nix.
