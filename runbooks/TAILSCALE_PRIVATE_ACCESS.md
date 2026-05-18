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
- Life OS note: Tailscale provides private reachability only. A CalDAV/WebDAV
  service still needs to be configured separately if it is not already active.

## Deploy The Declarative Config

From the canonical checkout on Nazar:

```bash
cd /home/alex/repos/nazar
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

1. Install Tailscale on the client device.
2. Join the same tailnet.
3. Enable MagicDNS in the Tailscale admin UI if desired.
4. Use Nazar's MagicDNS hostname or tailnet IP for private endpoints.

Example placeholder URL once a private HTTPS vhost exists:

```text
https://nazar.<tailnet>.ts.net/
```

Replace `<tailnet>` with the real tailnet DNS name.

## Human Apps

Suggested clients once CalDAV/WebDAV endpoints exist:

- iOS: Apple Calendar and Reminders for CalDAV/VTODO; a WebDAV-capable Files app
  integration or third-party file client for WebDAV files.
- Android: DAVx⁵ for sync, Tasks.org for VTODO/reminders, and Etar or Google
  Calendar for calendar display.
- Desktop: Thunderbird for CalDAV calendars/tasks; a WebDAV mount, `rclone`, or
  Obsidian over synced Markdown for notes/journal files.

## HTTPS Certificates

CalDAV/WebDAV clients are usually happier with HTTPS even though tailnet traffic
is already encrypted.

Tailscale certificates can be generated at runtime after HTTPS support is
enabled for the tailnet:

```bash
sudo tailscale cert nazar.<tailnet>.ts.net
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

## Follow-Up: Life OS DAV Service

The current Life OS host module installs the CLI and creates `/srv/life` data
directories. A separate private DAV implementation should be added if it is not
already live. The likely shape is:

- `services.radicale` for CalDAV/VTODO.
- nginx with WebDAV support for files.
- private-only vhosts reachable over `tailscale0`.
- explicit authentication/app passwords.
- no public TCP/80 or TCP/443 exposure.
