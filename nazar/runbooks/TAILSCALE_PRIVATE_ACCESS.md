# Tailscale Private Access Runbook

Nazar uses Tailscale as the private network path for human apps that need stable
CalDAV/WebDAV-style sync. Public exposure stays minimal: SSH remains the public
operator entrypoint, and DAV/personal-data services should be reachable only over
the tailnet unless a separate public-service design explicitly changes that.

## Model

- Server: `nazar` joins the tailnet through `tailscaled.service`.
- Public firewall: keep public HTTP/DAV closed by default.
- Tailnet firewall: allow only explicit service ports on `tailscale0`.
- Secrets: do not place Tailscale auth keys, OAuth credentials, or certificate
  private keys in Nix expressions.
- Life OS note: Tailscale provides private reachability for the current private
  WebDAV endpoint at `http://nazar.ojos-sargas.ts.net/life/`. CalDAV/VTODO/CardDAV can be
  added separately when calendar/task/contact sync is wired end-to-end.

## Deploy The Declarative Config

From the canonical checkout on Nazar:

```bash
cd /home/alex/repos/ownloom/nazar
nix flake check --no-build
nix build .#nixosConfigurations.nazar.config.system.build.toplevel --print-build-logs
sudo nixos-rebuild switch --flake .#nazar
```

Do not use `--impure` for these checks or builds.

## One-Time Server Enrollment

After the declarative switch enables `tailscaled.service`, enroll Nazar into the
chosen tailnet:

```bash
sudo tailscale up --hostname=nazar --ssh=false
```

Notes:

- `--ssh=false` keeps Tailscale SSH disabled; OpenSSH remains the SSH path until
  Tailscale SSH is deliberately designed and enabled.
- Complete the browser/device login through the chosen Tailscale account.
- If using reusable auth keys later, store them as runtime secrets and reference
  secret files; never paste keys into Nix files.

## Server Verification

```bash
systemctl is-active tailscaled
systemctl status tailscaled --no-pager
sudo tailscale status
sudo tailscale ip -4
sudo tailscale ip -6
```

Firewall spot-check:

```bash
sudo nft list ruleset | grep -i tailscale -A5 -B5 || true
```

The expected shape is:

- Tailscale is active.
- Nazar appears in `tailscale status`.
- Nazar has a tailnet IP.
- Public TCP/80 and TCP/443 are not opened just because Tailscale is enabled.
- Only explicit private ports are allowed on `tailscale0`.

## Client Setup

For the declarative `alex-laptop` NixOS config, Tailscale is enabled through
`nix/modules/laptop/tailscale.nix`. After pulling the repo on the laptop, switch
that host config and enroll it once:

```bash
cd /home/alex/repos/ownloom/nazar
sudo nixos-rebuild switch --flake .#alex-laptop
sudo tailscale up --hostname=alex-laptop --ssh=false
```

For other client devices:

1. Install Tailscale on the client device.
2. Join the same tailnet.
3. Enable MagicDNS in the Tailscale admin UI if desired.
4. Use Nazar's MagicDNS hostname for private endpoints.

Example placeholder URL once a private HTTPS vhost exists:

```text
https://nazar.ojos-sargas.ts.net/
```

Replace `ojos-sargas` with the real tailnet DNS name.

## Human Apps

Suggested clients for the current setup:

- NixOS laptop: `nazar.lifeOs.client` installs Obsidian, Thunderbird, and
  the declarative CLI stack (`vdirsyncer`, `khal`, `khard`, `todoman`). It
  mounts WebDAV at `/home/alex/LifeOS` and syncs CalDAV/CardDAV from Radicale
  at `http://nazar.ojos-sargas.ts.net:5232/`. KDE PIM apps are optional and disabled by
  default.
- iOS: a WebDAV-capable Files app integration or third-party file client for
  Life OS files. Calendar/Reminders can use the Radicale CalDAV endpoint once
  the device is on Tailscale.
- Android: a WebDAV file client for Life OS files. DAVx⁵ + Tasks.org/Etar can
  consume Radicale CalDAV/VTODO/CardDAV once the device is on Tailscale.
- Desktop: Obsidian over `/home/alex/LifeOS` for Markdown; Thunderbird for
  human calendar/contact/task UI; `khal`/`khard`/`todoman` for the fully
  declarative local vdir layer. KDE PIM can be enabled separately if desired.

See `runbooks/LIFE_OS_CLIENTS.md` for NixOS client setup and verification.

## HTTPS Certificates

CalDAV/WebDAV clients are usually happier with HTTPS even though tailnet traffic
is already encrypted.

Tailscale certificates can be generated at runtime after HTTPS support is
enabled for the tailnet:

```bash
sudo tailscale cert nazar.ojos-sargas.ts.net
```

Certificate automation should be designed separately. Store generated
certificates and private keys under runtime state such as `/var/lib/...`, not in
Nix store paths.

## Relationship To SSH Tunnels

SSH local forwarding remains the fallback/admin path, especially for loopback-only
services such as the Hermes Dashboard. Prefer Tailscale for phone/desktop apps
that need persistent background sync because mobile CalDAV/WebDAV clients cannot
reliably use SSH tunnels.

## Rollback

To disconnect without changing the NixOS generation:

```bash
sudo tailscale down
sudo systemctl stop tailscaled
```

To remove Tailscale declaratively, revert the Tailscale module/import change and
switch to the previous or updated NixOS configuration.

## Follow-Up: CalDAV/CardDAV Authentication And HTTPS

The current private services expose:

- `/srv/life` as WebDAV files over Tailscale at `http://nazar.ojos-sargas.ts.net/life/`.
- Radicale CalDAV/CardDAV/VTODO over Tailscale at `http://nazar.ojos-sargas.ts.net:5232/`.

Still to design separately:

- explicit DAV authentication/app passwords if tailnet-only network trust is not
  sufficient.
- private HTTPS using Tailscale certificates.
- no public TCP/80, TCP/443, or TCP/5232 exposure.
