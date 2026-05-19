# NixOS Guest Infrastructure on Proxmox — Phased Plan

Date: 2026-05-19
Host: `proxmox`
Proxmox IP: `167.235.12.22`

## Goal

Use Proxmox VE as the stable bare-metal hypervisor and run Headscale, Gogs/Forgejo, and future services as declarative NixOS guests.

High-level target:

```text
Proxmox = stable hypervisor
NixOS VMs = declarative service layer
Git repo = source of truth
Headscale = private management network
Caddy = controlled public HTTPS edge
Gogs/Forgejo = private Git service, optionally public HTTPS
```

## Recommended Architecture

```text
Hetzner bare metal
└── Proxmox VE 9
    ├── vmbr0: public bridge / host uplink
    ├── vmbr1: private service network, e.g. 10.10.10.0/24
    │
    ├── VM 100: edge / reverse proxy
    │   └── NixOS + Caddy
    │       Public 80/443 via Proxmox forwarding
    │       Reverse proxies to private services
    │
    ├── VM 101: headscale
    │   └── NixOS + services.headscale
    │
    ├── VM 102: git
    │   └── NixOS + Gogs or Forgejo
    │
    └── future VMs
        └── NixOS flakes
```

## Design Rules

### Rule 1 — Proxmox stays boring

Proxmox should run:

```text
VMs
networking
storage
backups
firewall/NAT
```

Proxmox should not directly host:

```text
Headscale
Gogs
Caddy
databases
random app services
```

### Rule 2 — NixOS owns service configuration

If a service is important, it should be in Git and deployed declaratively.

Avoid hidden hand-edited production configs where possible.

### Rule 3 — expose only the edge

Public exposure should be minimal.

Recommended public ports:

```text
22/tcp   SSH to Proxmox, key-only
80/tcp   edge Caddy, HTTP/ACME redirect
443/tcp  edge Caddy, HTTPS
```

Optional later:

```text
2222/tcp public Git SSH
```

Private-only services:

```text
Proxmox UI
Headscale admin/API where possible
Gogs/Forgejo admin
databases
metrics
```

### Rule 4 — state is separate from config

Config lives in Git:

```text
flake.nix
hosts/*
modules/*
runbooks/*
```

State lives under service state directories and must be backed up:

```text
/var/lib/headscale
/var/lib/gogs
/var/lib/forgejo
/var/lib/caddy
/var/lib/postgresql, if used
```

### Rule 5 — build once manually, then automate

For the first NixOS VM, manual installation is acceptable.

After the pattern is proven, automate with tools such as:

```text
NixOS VM templates
nixos-anywhere
disko
deploy-rs
colmena
```

Do not over-automate before one working VM proves the network and deployment model.

---

# Overall Phases

## Phase 1 — Build the Proxmox → NixOS VM foundation

Goal: make Proxmox capable of hosting repeatable NixOS guests cleanly.

This includes:

1. Create a private service bridge on Proxmox.
2. Decide VM naming/IP conventions.
3. Create a first minimal NixOS VM.
4. Get SSH access into that VM.
5. Add that VM to a Nix flake.
6. Verify it can be rebuilt declaratively.
7. Document the pattern so future VMs are easy.

Result:

```text
Proxmox host
├── vmbr0 public uplink
└── vmbr1 private services network
    └── first NixOS VM, reachable by SSH
```

This phase does not install Headscale or Gogs yet. It proves the NixOS VM pattern works.

## Phase 2 — Create the edge / reverse proxy VM

Goal: create the public web entrypoint.

The edge VM runs Caddy or Nginx. Caddy is recommended.

Result:

```text
Public internet
  |
  | 80/443
  v
edge VM
  |
  +-- reverse_proxy headscale VM
  +-- reverse_proxy gogs/forgejo VM
```

The edge VM becomes the only component that needs public HTTP/HTTPS exposure.

## Phase 3 — Create the Headscale VM

Goal: deploy Headscale declaratively on NixOS.

Result:

```text
https://headscale.<domain>
```

Then enroll:

- laptop
- optionally the Proxmox host
- later the Git VM
- future service VMs

After this, Proxmox UI can be reached through the tailnet instead of SSH tunnels.

## Phase 4 — Create the Git VM

Goal: deploy Gogs, or possibly Forgejo, declaratively on NixOS.

Result:

```text
https://git.<domain>
```

Git over SSH can be either:

```text
private through Headscale
```

or:

```text
public on port 2222
```

Recommended starting point: private-first.

## Phase 5 — Backups, snapshots, monitoring, runbooks

Goal: make the setup recoverable.

This includes:

- Proxmox VM snapshots
- file-level backups of service state
- documented restore process
- health checks
- monitoring
- upgrade playbooks

---

# Phase 1 in Detail: Proxmox → NixOS VM Foundation

## Objective

Create a repeatable pattern for running NixOS guests under Proxmox.

At the end of Phase 1, the environment should have:

```text
1 working NixOS VM
1 private Proxmox bridge
1 Nix flake host config
1 documented deployment workflow
```

The first VM can be called `edge` if it will become the reverse proxy VM. If it is only a disposable learning VM, call it `nix-seed`.

Recommended practical choice:

```text
edge
```

The edge VM is the least stateful service. If a mistake is made, it can be destroyed and recreated with low risk.

## Current Proxmox Networking

Current public bridge:

```text
vmbr0 = public bridge
167.235.12.22/26
gateway 167.235.12.1
```

This is the public Hetzner-facing bridge.

Add a private internal service bridge:

```text
vmbr1 = private internal service bridge
10.10.10.1/24
```

Final host network shape:

```text
Proxmox host
├── vmbr0: public network
│   └── 167.235.12.22/26
│
└── vmbr1: private service LAN
    └── 10.10.10.1/24
```

Later VMs receive private IPs:

```text
edge        10.10.10.10
headscale   10.10.10.11
git         10.10.10.12
```

## Why create `vmbr1`?

We do not want every VM to sit directly on the public internet.

Instead:

```text
Public internet
  |
  v
Proxmox / edge only
  |
  v
Private services
```

Benefits:

- cleaner firewalling
- fewer accidentally public services
- easier reverse proxying
- easier future expansion
- private communication between VMs
- less Hetzner networking complexity

The private bridge is internal to Proxmox and does not require an extra public IP.

## Phase 1 Architecture

After Phase 1:

```text
           Internet
              |
              |
          vmbr0 public
              |
        Proxmox host
              |
          vmbr1 private
              |
          edge VM
       10.10.10.10
```

Initially, the VM only needs SSH and NixOS working.

It does not need to serve public web traffic yet.

---

## Phase 1 Step-by-Step

### Step 1 — Add private bridge `vmbr1`

Modify Proxmox networking to add:

```text
auto vmbr1
iface vmbr1 inet static
    address 10.10.10.1/24
    bridge-ports none
    bridge-stp off
    bridge-fd 0
```

This creates an isolated private network. No physical NIC is attached.

Meaning:

```text
vmbr1 only connects Proxmox guests to each other and to the Proxmox host.
```

#### Verification

On Proxmox:

```bash
ip -br addr show vmbr1
```

Expected:

```text
vmbr1 UP 10.10.10.1/24
```

Check routing:

```bash
ip route
```

Expected to include:

```text
10.10.10.0/24 dev vmbr1
```

### Step 2 — Enable forwarding/NAT if needed

There are two possible patterns for private VMs.

#### Pattern A — no NAT initially

VMs on `vmbr1` can talk to the Proxmox host, but not the internet.

This is only okay if another network interface gives them internet access.

#### Pattern B — NAT private VMs through Proxmox

VMs on `vmbr1` reach the internet through the Proxmox host.

This is useful for NixOS installs and updates.

Conceptually:

```text
NixOS VM 10.10.10.10
  -> Proxmox 10.10.10.1
  -> NAT through 167.235.12.22
  -> internet
```

Recommended: enable NAT for `10.10.10.0/24` out through `vmbr0`.

#### Verification

From a VM later:

```bash
ping 10.10.10.1
ping 1.1.1.1
curl -I https://cache.nixos.org
```

Expected:

```text
private gateway works
internet works
Nix cache reachable
```

### Step 3 — Decide the VM network model

For the `edge` VM there are two approaches.

#### Option 1 — edge VM only on private network, Proxmox forwards 80/443

```text
Internet
  |
  | 80/443
  v
Proxmox host
  |
  | DNAT
  v
edge VM 10.10.10.10
```

Pros:

- simple Hetzner networking
- no extra public IP needed
- edge VM remains private
- Proxmox controls port exposure

Cons:

- Proxmox host has NAT/port-forward rules
- Proxmox becomes part of the ingress path

Recommended starting point.

#### Option 2 — edge VM gets public networking directly

```text
Internet
  |
  v
edge VM directly on vmbr0
```

Pros:

- cleaner edge architecture
- edge VM owns public 80/443 directly

Cons:

- may require additional Hetzner IP/MAC setup
- more networking complexity
- easier to misconfigure

Not recommended for the first iteration.

### Recommended Phase 1 choice

Use:

```text
private vmbr1 + NAT + later Proxmox port forwards
```

So the edge VM has:

```text
IP: 10.10.10.10
Gateway: 10.10.10.1
```

Later Proxmox forwards:

```text
167.235.12.22:80  -> 10.10.10.10:80
167.235.12.22:443 -> 10.10.10.10:443
```

### Step 4 — Create the first NixOS VM

Recommended settings:

```text
VM ID: 100
Name: edge
OS: NixOS
CPU: 1 vCPU
RAM: 1024 MB
Disk: 16 GB
Network: virtio on vmbr1
IP: 10.10.10.10/24
Gateway: 10.10.10.1
```

Disk/storage:

```text
local
/var/lib/vz
```

Network device:

```text
virtio
bridge vmbr1
```

Firmware:

```text
SeaBIOS is fine
```

Disk bus:

```text
SCSI with VirtIO SCSI
```

QEMU guest agent:

```text
enable it
```

### Step 5 — Install NixOS into the VM

Two possible install paths:

#### Option A — ISO install

Download NixOS ISO into Proxmox, boot VM, manually install once.

Pros:

- simple
- easy to debug
- good first-time path

Cons:

- manual
- not fully automated yet

#### Option B — automated image/cloud-init

Use a prebuilt NixOS image or custom image.

Pros:

- repeatable
- fast future provisioning

Cons:

- more setup now
- more moving parts

Recommended for Phase 1:

```text
Manual ISO install first.
Automate after pattern is proven.
```

### Minimal NixOS install goal

Inside the VM, the minimal configuration should enable:

```nix
{
  services.openssh.enable = true;

  users.users.alex = {
    isNormalUser = true;
    extraGroups = [ "wheel" ];
    openssh.authorizedKeys.keys = [
      "<alex public key>"
    ];
  };

  networking.hostName = "edge";

  networking.interfaces.ens18.ipv4.addresses = [
    {
      address = "10.10.10.10";
      prefixLength = 24;
    }
  ];

  networking.defaultGateway = "10.10.10.1";
  networking.nameservers = [
    "1.1.1.1"
    "8.8.8.8"
  ];

  security.sudo.wheelNeedsPassword = false;
}
```

The actual interface may be `ens18` or similar. Verify it inside the VM before finalizing.

### Step 6 — SSH into the VM

From the Proxmox host:

```bash
ssh alex@10.10.10.10
```

From the laptop, initially use a jump through Proxmox:

```bash
ssh -J proxmox alex@10.10.10.10
```

Possible SSH config:

```sshconfig
Host edge
  HostName 10.10.10.10
  User alex
  ProxyJump proxmox
  IdentityFile ~/.ssh/proxmox_alex_ed25519
  IdentitiesOnly yes
```

Then:

```bash
ssh edge
```

Later, after Headscale, direct private access becomes cleaner.

### Step 7 — Create or extend the Nix flake

Use a repo-controlled source of truth.

Two choices:

#### Option A — extend existing `ownloom/nazar`

Existing flake:

```text
/home/alex/repos/ownloom/nazar/flake.nix
```

It already has:

```text
nixosConfigurations.nazar
nixosConfigurations.alex-laptop
```

Could add:

```text
nixosConfigurations.edge
nixosConfigurations.headscale
nixosConfigurations.git
```

Pros:

- reuse existing patterns
- faster
- one flake

Cons:

- `nazar` may become overloaded
- name no longer matches broader infra role

#### Option B — create a new infra flake

Recommended path:

```text
/home/alex/repos/ownloom/infra
```

Possible layout:

```text
/home/alex/repos/ownloom/infra/
├── flake.nix
├── hosts/
│   ├── edge/
│   │   ├── configuration.nix
│   │   └── hardware-configuration.nix
│   ├── headscale/
│   │   └── configuration.nix
│   └── git/
│       └── configuration.nix
├── modules/
│   ├── common.nix
│   ├── proxmox-vm.nix
│   ├── headscale.nix
│   ├── git-service.nix
│   └── caddy-edge.nix
└── docs/
    └── runbooks/
```

Pros:

- cleaner long-term
- clear separation from Nazar
- better for future VMs

Cons:

- a little more setup now

Recommendation:

```text
/home/alex/repos/ownloom/infra
```

This is broader than Nazar and represents the Proxmox/NixOS infrastructure layer.

### Step 8 — First flake structure

Initial structure:

```text
infra/
├── flake.nix
├── hosts/
│   └── edge/
│       ├── configuration.nix
│       └── hardware-configuration.nix
└── modules/
    ├── common.nix
    └── proxmox-vm.nix
```

#### `modules/common.nix`

Shared defaults for all NixOS guests:

```nix
{
  config,
  pkgs,
  ...
}:

{
  time.timeZone = "UTC";

  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = false;
      PermitRootLogin = "no";
    };
  };

  users.users.alex = {
    isNormalUser = true;
    extraGroups = [ "wheel" ];
    openssh.authorizedKeys.keys = [
      "<alex public key>"
    ];
  };

  security.sudo.wheelNeedsPassword = false;

  environment.systemPackages = with pkgs; [
    vim
    git
    curl
    wget
    htop
  ];

  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];
}
```

#### `modules/proxmox-vm.nix`

VM-specific defaults:

```nix
{
  config,
  pkgs,
  ...
}:

{
  services.qemuGuest.enable = true;

  boot.loader.grub.enable = true;
  boot.loader.grub.device = "/dev/sda";

  networking.useDHCP = false;
}
```

#### `hosts/edge/configuration.nix`

Host-specific edge config:

```nix
{
  config,
  pkgs,
  ...
}:

{
  imports = [
    ../../modules/common.nix
    ../../modules/proxmox-vm.nix
    ./hardware-configuration.nix
  ];

  networking.hostName = "edge";

  networking.interfaces.ens18.ipv4.addresses = [
    {
      address = "10.10.10.10";
      prefixLength = 24;
    }
  ];

  networking.defaultGateway = "10.10.10.1";

  networking.nameservers = [
    "1.1.1.1"
    "9.9.9.9"
  ];

  networking.firewall.enable = true;
  networking.firewall.allowedTCPPorts = [
    22
  ];

  system.stateVersion = "26.05";
}
```

The exact `system.stateVersion` depends on the installed NixOS version. Set it to the installed version and do not casually bump it later.

### Step 9 — Rebuild VM from the flake

Once the VM is installed manually, clone or copy the flake onto it.

Run on the VM:

```bash
sudo nixos-rebuild switch --flake /path/to/infra#edge
```

Or from the laptop:

```bash
nixos-rebuild switch \
  --flake /home/alex/repos/ownloom/infra#edge \
  --target-host alex@10.10.10.10 \
  --use-remote-sudo
```

At first, running directly on the VM is acceptable. Later, use remote deployment tooling.

### Step 10 — Verify Phase 1

#### Proxmox bridge exists

On Proxmox:

```bash
ip -br addr show vmbr1
```

Expected:

```text
vmbr1 UP 10.10.10.1/24
```

#### VM exists

On Proxmox:

```bash
qm list
```

Expected:

```text
100 edge running
```

#### VM has correct IP

From Proxmox:

```bash
ping 10.10.10.10
```

Expected:

```text
packets received
```

#### VM has internet

From VM:

```bash
curl -I https://cache.nixos.org
```

Expected:

```text
HTTP 200 or HTTP 301/302
```

#### SSH works

From Proxmox or via jump:

```bash
ssh alex@10.10.10.10
```

Expected:

```text
login succeeds with key
```

#### Nix flake rebuild works

On VM:

```bash
sudo nixos-rebuild switch --flake /path/to/infra#edge
```

Expected:

```text
switching to configuration...
```

#### QEMU guest agent works

On Proxmox:

```bash
qm agent 100 ping
```

Expected:

```text
success
```

#### Firewall is minimal

From outside, only Proxmox SSH should remain public. The VM should not be directly reachable from the public internet.

## Phase 1 Deliverables

By the end of Phase 1:

```text
Proxmox:
  vmbr1 private bridge
  NAT for 10.10.10.0/24
  VM 100 edge

NixOS:
  edge boots
  edge has static IP 10.10.10.10
  edge has SSH
  edge has QEMU guest agent
  edge can reach internet
  edge can be rebuilt from flake

Repo:
  infra flake exists
  edge host config exists
  common module exists
  proxmox-vm module exists
  runbook updated
```

## Recommended Immediate Phase 1 Task List

### Task 1 — Update Proxmox networking docs/check current config

- Inspect `/etc/network/interfaces`.
- Confirm `vmbr0`.
- Add planned `vmbr1`.
- Document rollback.

### Task 2 — Add `vmbr1`

Add:

```text
vmbr1 10.10.10.1/24
```

Apply safely.

### Task 3 — Add NAT for private VM internet

Enable forwarding and masquerade:

```text
10.10.10.0/24 -> vmbr0
```

### Task 4 — Download NixOS ISO

Store it in Proxmox local ISO storage.

### Task 5 — Create VM 100 `edge`

Settings:

```text
1 CPU
1 GB RAM
16 GB disk
virtio net on vmbr1
QEMU guest agent enabled
```

### Task 6 — Install NixOS manually

Static config:

```text
IP: 10.10.10.10/24
GW: 10.10.10.1
DNS: 1.1.1.1
SSH enabled
alex key installed
```

### Task 7 — Verify VM

Check:

```text
boots
SSH works
internet works
qemu guest agent works
```

### Task 8 — Create infra flake

Recommended path:

```text
/home/alex/repos/ownloom/infra
```

Initial hosts:

```text
edge
```

Initial modules:

```text
common.nix
proxmox-vm.nix
```

### Task 9 — Rebuild edge from flake

Run:

```bash
sudo nixos-rebuild switch --flake .#edge
```

### Task 10 — Update runbook

Document:

```text
network layout
VM ID
IP
install method
SSH method
rebuild command
recovery steps
```

---

# Phase 2 in Detail: Edge / Reverse Proxy VM

## Objective

Run Caddy on `edge`.

Expose:

```text
80/tcp
443/tcp
```

to the internet.

Keep backend services private.

## Architecture

```text
Internet
  |
  | 80/443
  v
Proxmox host
  |
  | port forward
  v
edge VM 10.10.10.10
  |
  +-- headscale VM 10.10.10.11:8080
  +-- git VM 10.10.10.12:3000
```

## NixOS config shape

```nix
{
  services.caddy = {
    enable = true;

    virtualHosts."headscale.example.com".extraConfig = ''
      reverse_proxy 10.10.10.11:8080
    '';

    virtualHosts."git.example.com".extraConfig = ''
      reverse_proxy 10.10.10.12:3000
    '';
  };

  networking.firewall.allowedTCPPorts = [
    22
    80
    443
  ];
}
```

## DNS needed

Point these records to the Proxmox public IP:

```text
headscale.example.com -> 167.235.12.22
git.example.com       -> 167.235.12.22
```

Both hit the same public IP. Caddy routes based on hostname.

## Proxmox forwarding

Proxmox forwards:

```text
167.235.12.22:80  -> 10.10.10.10:80
167.235.12.22:443 -> 10.10.10.10:443
```

## Verification

```bash
curl -I http://headscale.example.com
curl -I https://headscale.example.com
```

Before Headscale exists, Caddy may return `502`. That is acceptable because it proves Caddy is publicly reachable and proxying to a backend placeholder.

---

# Phase 3 in Detail: Headscale VM

## Objective

Create a NixOS VM for Headscale.

Suggested VM:

```text
VM ID: 101
Name: headscale
IP: 10.10.10.11
CPU: 1
RAM: 1 GB
Disk: 16 GB
```

## Architecture

```text
Laptop Tailscale client
  |
  v
https://headscale.example.com
  |
  v
edge Caddy
  |
  v
headscale VM:8080
```

## NixOS service shape

```nix
{
  services.headscale = {
    enable = true;
    address = "0.0.0.0";
    port = 8080;

    settings = {
      server_url = "https://headscale.example.com";

      dns = {
        magic_dns = true;
        base_domain = "tail.example.com";
      };
    };
  };

  networking.firewall.allowedTCPPorts = [
    22
    8080
  ];
}
```

Even though the Headscale VM allows `8080`, topology keeps it private because it is only on the private service network. Public access happens through the edge Caddy VM.

## Data to back up

```text
/var/lib/headscale
/etc/headscale, if used
```

## First user/node flow

1. Create Headscale user.
2. Generate preauth key.
3. Install Tailscale client on laptop.
4. Point it at the Headscale login server.
5. Confirm laptop appears in Headscale.
6. Optionally enroll Proxmox host.
7. Optionally enroll edge VM.

## Verification

```bash
systemctl status headscale
curl http://10.10.10.11:8080/health
curl https://headscale.example.com/health
```

Expected:

```text
ok
```

Then:

```bash
headscale nodes list
```

Expected:

```text
laptop node appears
```

---

# Phase 4 in Detail: Gogs / Git VM

## Objective

Create a NixOS VM for Git hosting.

Suggested VM:

```text
VM ID: 102
Name: git
IP: 10.10.10.12
CPU: 2
RAM: 2-4 GB
Disk: 50-100 GB
```

## Gogs vs Forgejo

Gogs is lightweight and simple.

Forgejo is more active and modern.

Comparison:

| Option | Pros | Cons |
|---|---|---|
| Gogs | very lightweight, simple | slower-moving ecosystem |
| Forgejo | active, modern, good community direction | heavier than Gogs |
| Gitea | common, mature | governance/history concerns for some users |

If the goal is a small private Git server, Gogs is acceptable. If the goal is a long-term self-hosted Git platform, Forgejo is probably the better default.

## Deployment options

### Option 1 — Native NixOS service

Preferred if the package/module is healthy.

Example shape:

```nix
{
  services.gogs = {
    enable = true;
    appName = "Ownloom Git";
    domain = "git.example.com";
    httpPort = 3000;
    rootUrl = "https://git.example.com/";
  };

  networking.firewall.allowedTCPPorts = [
    22
    3000
  ];
}
```

### Option 2 — Container managed by NixOS

If native Gogs is stale, use the newer upstream container image:

```text
gogs/gogs:next-latest
```

NixOS can manage it declaratively with Podman.

## Git SSH options

### Option A — private-only Git SSH over Headscale

Best for personal/private setup.

```text
git clone ssh://git@git.tail.example.com/repo.git
```

### Option B — public Git SSH on port 2222

Useful if cloning without VPN/tailnet is required.

```text
git clone ssh://git@git.example.com:2222/alex/repo.git
```

Recommended starting point: private-only.

## Data to back up

```text
/var/lib/gogs
```

Or the state directory used by the NixOS module.

If PostgreSQL is used:

```text
/var/lib/postgresql
```

For small Gogs, SQLite may be fine initially.

---

# Phase 5 in Detail: Backups, Snapshots, Monitoring

## Objective

Make sure the setup survives mistakes, upgrades, and service failures.

## Backup layers

### Layer 1 — Git repo

Stores declarative config:

```text
flake.nix
hosts/*
modules/*
runbooks/*
```

This is the source of truth.

### Layer 2 — Proxmox VM snapshots

Useful before upgrades.

Good snapshot moments:

```text
before Headscale upgrade
before Gogs/Forgejo upgrade
before NixOS major version upgrade
before networking/firewall changes
```

### Layer 3 — file-level service backups

Important state:

```text
Headscale:
  /var/lib/headscale

Gogs/Forgejo:
  /var/lib/gogs or /var/lib/forgejo
  repositories
  database

Caddy:
  /var/lib/caddy
  certificates if needed
```

### Layer 4 — offsite backups

Eventually use one of:

```text
restic
borg
rclone
```

Possible targets:

- Backblaze B2
- Hetzner Storage Box
- another server
- local encrypted backup

## Monitoring

Start simple:

```text
systemd service health
disk usage
certificate expiry
Headscale health endpoint
Git HTTP check
Proxmox RAID status
```

Later:

```text
Prometheus + Grafana
Uptime Kuma
systemd timers
```

---

# Immediate Open Decision

Before executing Phase 1, decide whether the new NixOS infrastructure flake should live at:

Recommended:

```text
/home/alex/repos/ownloom/infra
```

Alternative:

```text
/home/alex/repos/ownloom/nazar
```

Recommendation: use `/home/alex/repos/ownloom/infra`, because this is broader than Nazar and represents the Proxmox/NixOS infrastructure layer.

---

# Phase 1 Execution Notes — 2026-05-19

Phase 1 has been implemented.

## Proxmox host changes

Private bridge added to `/etc/network/interfaces`:

```text
auto vmbr1
iface vmbr1 inet static
  address 10.10.10.1/24
  bridge-ports none
  bridge-stp off
  bridge-fd 0
```

IPv4 forwarding enabled via:

```text
/etc/sysctl.d/99-ownloom-private-guests.conf
```

with:

```text
net.ipv4.ip_forward=1
```

NAT/masquerade for private guests added via `/etc/nftables.conf`:

```nft
table ip ownloom_nat {
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    ip saddr 10.10.10.0/24 oifname "vmbr0" masquerade
  }
}
```

The `nftables` service is enabled and running.

## NixOS infra flake

Created:

```text
/home/alex/repos/ownloom/infra
```

Initial layout:

```text
infra/
├── flake.nix
├── flake.lock
├── hosts/
│   └── edge/
│       └── configuration.nix
└── modules/
    ├── common.nix
    ├── proxmox-image.nix
    └── proxmox-vm.nix
```

Important implementation detail: `modules/proxmox-vm.nix` explicitly sets initrd modules for Proxmox VirtIO boot:

```nix
boot.initrd.availableKernelModules = [
  "ata_piix"
  "uhci_hcd"
  "virtio_pci"
  "virtio_blk"
  "virtio_scsi"
  "sd_mod"
  "sr_mod"
];
```

This is required. Without these modules, a system rebuilt from the flake can fail in stage 1 with:

```text
Timed out waiting for device /dev/disk/by-label/nixos
```

because the initrd cannot see the VirtIO root disk.

## Edge VM

Created VM:

```text
VM ID: 100
Name: edge
CPU: 1 core
RAM: 1024 MiB
Disk: 16 GiB qcow2 on local storage
Network: virtio on vmbr1
IP: 10.10.10.10/24
Gateway: 10.10.10.1
QEMU guest agent: enabled
On boot: enabled
```

Current Proxmox config highlights:

```text
agent: enabled=1
boot: order=virtio0
cores: 1
memory: 1024
name: edge
net0: virtio=<generated-mac>,bridge=vmbr1
onboot: 1
vga: std
virtio0: local:100/vm-100-disk-0.qcow2,size=16G
```

## Deployment command

From the laptop/development machine, deploy the edge host with:

```bash
cd /home/alex/repos/ownloom/infra

NIX_SSHOPTS='-o ProxyJump=proxmox -i /home/alex/.ssh/proxmox_alex_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' \
  nixos-rebuild switch \
  --flake .#edge \
  --target-host alex@10.10.10.10 \
  --sudo \
  --no-reexec
```

`alex` is configured as a trusted Nix user on the guest so local builds can be copied to the VM by `nixos-rebuild`.

## SSH access

Current access path from the laptop:

```bash
ssh -i ~/.ssh/proxmox_alex_ed25519 \
  -o IdentitiesOnly=yes \
  -J proxmox \
  alex@10.10.10.10
```

Suggested SSH config:

```sshconfig
Host edge
  HostName 10.10.10.10
  User alex
  ProxyJump proxmox
  IdentityFile ~/.ssh/proxmox_alex_ed25519
  IdentitiesOnly yes
```

Then:

```bash
ssh edge
```

## Verification results

Verified after reboot:

```text
Proxmox vmbr1: 10.10.10.1/24
IPv4 forwarding: enabled
nft NAT: 10.10.10.0/24 -> vmbr0 masquerade
VM 100 status: running
Ping Proxmox -> 10.10.10.10: OK
QEMU guest agent: OK
Guest hostname: edge
Guest IP: 10.10.10.10/24 on ens18
Guest default route: 10.10.10.1
Guest SSH: active
Guest qemu-guest-agent: active
Guest internet/Nix cache: HTTPS 200 from https://cache.nixos.org/
Local nixos-rebuild to target: OK
Reboot after rebuild: OK
```

Guest current system at verification time:

```text
/nix/store/pljsz4b37krxmrl7x3x55asw4x5azggv-nixos-system-edge-25.11.20260514.d7a713c
```

## Phase 1 pitfalls encountered

1. A first rebuild made the VM fail at NixOS stage 1 because the initrd did not include VirtIO disk modules. Fix: explicitly add Proxmox/VirtIO initrd modules in `modules/proxmox-vm.nix`.
2. Building directly on a 1 GiB VM can be killed by the OOM killer. Preferred deployment is local build plus remote copy using `nixos-rebuild --target-host`. The guest config now trusts `alex` for Nix so this works.
3. Recreating the VM changes its SSH host key. If needed, remove the old known-host entry:

   ```bash
   ssh-keygen -R 10.10.10.10
   ```

## Phase 1 status

Complete.

Next phase: configure `edge` as the Caddy reverse proxy and add Proxmox port-forwarding for public `80/tcp` and `443/tcp`.

Dedicated follow-up runbooks:

```text
/home/alex/repos/ownloom/proxmox/runbooks/PHASE_1_COMPLETION.md
/home/alex/repos/ownloom/proxmox/runbooks/PHASE_2_EDGE_REVERSE_PROXY.md
```

Before changing Phase 2 infrastructure, read `PHASE_1_COMPLETION.md` for the verified baseline and `PHASE_2_EDGE_REVERSE_PROXY.md` for the implementation/rollback checklist.

---

# Phase 2 Execution Summary — 2026-05-19

Base Phase 2 has been implemented for public HTTP.

Implemented:

```text
Public http://167.235.12.22/
  -> Proxmox vmbr0 DNAT 80/tcp
  -> edge 10.10.10.10:80
  -> Caddy health response
```

Active health response:

```text
Nazar edge is online\n
```

Proxmox now DNATs public `80/tcp` and `443/tcp` to `10.10.10.10` with this active nftables table:

```nft
table ip ownloom_nat {
  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
    iifname "vmbr0" tcp dport { 80, 443 } dnat to 10.10.10.10
  }

  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    ip saddr 10.10.10.0/24 oifname "vmbr0" masquerade
  }
}
```

`edge` now runs Caddy from the NixOS config in:

```text
/home/alex/repos/ownloom/infra/hosts/edge/configuration.nix
```

Verification completed:

```text
nix flake check --no-build: passed
nixos-rebuild switch --target-host alex@10.10.10.10: passed
curl http://10.10.10.10/ from Proxmox: HTTP 200
curl http://167.235.12.22/ from outside: HTTP 200
caddy: active
sshd: active
qemu-guest-agent: active
edge outbound internet: OK
```

HTTPS remains pending a real DNS name. The raw-IP HTTPS probe is not expected to be valid until a domain/subdomain points at `167.235.12.22` and Caddy is configured with named virtual hosts.

Full Phase 2 notes and rollback steps are in:

```text
/home/alex/repos/ownloom/proxmox/runbooks/PHASE_2_EDGE_REVERSE_PROXY.md
```
