# WireGuard Access Runbook

Nazar uses native NixOS WireGuard on the host, not NetBird. This is the canonical access model right now.

Daily administration and private services should go through WireGuard. Public SSH remains enabled only as a hardened break-glass path.

## Server

- Interface: `wg0`
- Server address: `10.44.0.1/24`
- Public listen port: `51820/udp`
- Server private key path: `/var/lib/nazar/wireguard/wg0.key`
- Key generation: declarative NixOS `generatePrivateKeyFile`; the private key is generated on the host and must not be committed.
- Canonical host SSH: `ssh alex@10.44.0.1` over WireGuard.
- Public break-glass: key-only SSH to `alex@167.235.12.22` remains enabled but is not the normal path.

## Adding a client

1. Generate the client private key outside this repository:

   ```bash
   umask 077
   wg genkey > client.key
   wg pubkey < client.key > client.pub
   ```

2. Add only the client public key to `nix/modules/host/wireguard.nix` under `networking.wireguard.interfaces.wg0.peers`.
3. Assign one unique `/32` address, for example `10.44.0.2/32`.
4. Rebuild/deploy the host after review.
5. Treat every added peer as trusted for the WireGuard-private service network. Do not onboard broad/untrusted devices until DAV and any future sensitive services have service-level auth and backups validated.

Client config template:

```ini
[Interface]
PrivateKey = CLIENT_PRIVATE_KEY
Address = 10.44.0.2/32
DNS = 10.44.0.1

[Peer]
PublicKey = NAZAR_SERVER_PUBLIC_KEY
Endpoint = 167.235.12.22:51820
AllowedIPs = 10.44.0.0/24
PersistentKeepalive = 25
```

Get the server public key on `nazar` after the first deploy:

```bash
sudo wg show wg0 public-key
```

Private records served by dnsmasq on `10.44.0.1`:

- `git.nazar.studio` -> `10.44.0.1`
- `balaur.eu` -> `10.44.0.1` for private HTTP/operator paths such as `/nixpi/`
- `balaur.nazar.studio` -> `10.44.0.1` for private HTTP/operator paths such as `/nixpi/`
- `ownloom.nazar.studio` -> `10.44.0.1`
- `dav.nazar.studio` -> `10.44.0.1`
- `nixpi.nazar.studio` -> `10.44.0.1`
- `nixpi-git.nazar.studio` -> `10.44.0.1`
- `nixpi-minecraft.nazar.studio` -> `10.44.0.1`
- `nixpi-ownloom.nazar.studio` -> `10.44.0.1`
- `nixpi-dav-server.nazar.studio` -> `10.44.0.1`

Other DNS queries are forwarded upstream by dnsmasq.

## Public exposure model

Keep public DNS limited to intentionally public services such as Minecraft game names `balaur.eu` and `balaur.nazar.studio` pointing at `167.235.12.22`. WireGuard dnsmasq intentionally overrides those Minecraft names to `10.44.0.1` for private HTTP/operator paths such as `/nixpi/`. Do not publish public A/AAAA/CNAME records for `git.nazar.studio`, `ownloom.nazar.studio`, `dav.nazar.studio`, or `nixpi*.nazar.studio`; those names are private WireGuard DNS records.

Public firewall intent:

- keep `22/tcp` open for key-only `alex` break-glass SSH for now;
- open `51820/udp` for WireGuard;
- forward Minecraft `25565/tcp` and Simple Voice Chat `24454/udp` only;
- do not forward public `80/tcp` to Minecraft.

## Break-glass stance

Keep public SSH for now. It is key-only, alex-only, and root SSH is disabled. Do not remove it until:

1. WireGuard works from at least two independent devices.
2. Hetzner Rescue recovery is documented/tested.
3. A rollback-safe network-change procedure is documented.
4. The repo has an explicit migration commit disabling public SSH.

## Checks

```bash
sudo systemctl is-active wireguard-wg0 dnsmasq nginx git-ssh-proxy
sudo wg show wg0
sudo nft list ruleset | grep -E 'wg0|51820|25565|24454|dport 80|dport 10022'
```

From a WireGuard client:

```bash
dig @10.44.0.1 git.nazar.studio +short
dig @10.44.0.1 ownloom.nazar.studio +short
dig @10.44.0.1 dav.nazar.studio +short
dig @10.44.0.1 balaur.nazar.studio +short
dig @10.44.0.1 nixpi.nazar.studio +short
dig @10.44.0.1 nixpi-ownloom.nazar.studio +short
curl -I http://git.nazar.studio/
curl -I http://git.nazar.studio/nixpi/
curl -I http://balaur.nazar.studio/nixpi/
curl -I http://ownloom.nazar.studio/
curl -I http://dav.nazar.studio/
curl -I http://nixpi.nazar.studio/
curl -I http://nixpi-ownloom.nazar.studio/
curl -I http://ownloom.nazar.studio/nixpi/
git ls-remote ssh://git@git.nazar.studio:10022/nazar/nazar.git
```
