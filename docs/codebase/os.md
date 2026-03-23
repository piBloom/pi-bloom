# OS Modules

> NixOS integration, packaging, and first-boot wiring

## Responsibilities

Keep the Nix surface split by concern:

- `modules/options.nix` declares the public NixPI option surface.
- `modules/*.nix` implement services and policy.
- `hosts/*.nix` compose concrete machines and installer profiles.
- `pkgs/installer/*` owns install artifact generation.
- `services/*.nix` owns standalone service wrappers and runtime assets.

## Reading order

1. `options.nix`
2. `app.nix`, `broker.nix`, `matrix.nix`, `network.nix`
3. `firstboot.nix` and `shell.nix`
4. installer code under `core/os/pkgs/installer/`

## Cleanup rule

Avoid encoding the same install or service policy in multiple places. If shell scripts, Python installer helpers, and Nix modules all need the same rule, pick one canonical owner and make the rest thin wrappers.
| `app/default.nix` | App package | NixPI app derivation | Main package |

### Package Flow

```
flake.nix
    ↓
callPackage core/os/pkgs/pi     → piAgent
    ↓
callPackage core/os/pkgs/app    → appPackage (uses piAgent)
    ↓
NixOS modules use appPackage
```

---

## Host Configurations (`core/os/hosts/`)

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `x86_64.nix` | Desktop config | Managed NixPI desktop profile | Base installed system shape |
| `x86_64-vm.nix` | Desktop VM config | Desktop profile plus VM-only mounts | Local QEMU/dev target |
| `installer-iso.nix` | Installer image | Minimal console installer ISO with NixPI helper tooling | Official installation media |

### Host Configuration Pattern

```nix
{ config, pkgs, lib, ... }:
{
  imports = [
    self.nixosModules.nixpi
    self.nixosModules.firstboot
    ./hardware-configuration.nix
  ];

  nixpi.primaryUser = "pi";
}
```

---

## Important File Details

### `core/os/modules/options.nix`

**Responsibility**: Declares all NixPI NixOS options in one place.

**Option Hierarchy**:
```
nixpi
├── primaryUser
├── stateDir
├── bootstrap
│   ├── keepSshAfterSetup
│   └── ...
├── services
│   ├── daemon.enable
│   ├── home.enable
│   └── chat.enable
├── matrix
│   ├── enable
│   ├── port
│   └── ...
└── network
    ├── netbird.enable
    └── ...
```

**Inbound Dependencies**:
- All other modules reference these options
- User configurations set these options

---

### `core/os/modules/app.nix`

**Responsibility**: Defines the NixPI app package and main service.

**Key Definitions**:
- `nixpi-app` package (uses `appPackage` from specialArgs)
- `nixpi-daemon.service` systemd unit
- Runtime directory setup
- Environment configuration

**Service Configuration**:
```nix
systemd.services.nixpi-daemon = {
  description = "NixPI Matrix daemon";
  wantedBy = [ "multi-user.target" ];
  after = [ "network.target" "continuwuity.service" ];
  serviceConfig = {
    User = config.nixpi.primaryUser;
    ExecStart = "${appPackage}/bin/nixpi-daemon";
    # ...
  };
};
```

---

### `core/os/modules/broker.nix`

**Responsibility**: Privilege escalation service for elevated operations.

**Why It Exists**: The daemon runs without direct root privileges. Some operations (like certain NixOS commands) need elevated privileges. The broker acts as a controlled elevation point.

**Tools**:
| Tool | Purpose |
|------|---------|
| `nixpi-brokerctl grant-admin <duration>` | Grant admin privileges |
| `nixpi-brokerctl status` | Check broker status |
| `nixpi-brokerctl revoke-admin` | Revoke admin privileges |

**Autonomy Levels**:
- `observe` - Read state only
- `maintain` - Operate approved systemd units
- `admin` - Full elevation (time-bounded)

---

### `core/os/modules/matrix.nix`

**Responsibility**: Matrix Continuwuity homeserver configuration.

**Key Features**:
- Non-federating configuration (private server)
- Registration token required
- SQLite database (default)
- Runs on port 6167

**Registration Token**: Stored in `/var/lib/continuwuity/registration_token`

---

### `core/os/modules/network.nix`

**Responsibility**: Network configuration including NetBird and firewall.

The first-boot path is WiFi-first on mini-PC installs. Ethernet remains enabled as fallback, but saved WiFi profiles are given higher NetworkManager autoconnect priority.

**Security Model**:
```nix
networking.firewall = {
  trustedInterfaces = [ "wt0" ];  # NetBird only
  # All services only accessible via wt0
};
```

**Critical**: Without NetBird running, services are exposed to local network.

---

## Related Tests

| Test Area | Location | Coverage |
|-----------|----------|----------|
| NixOS smoke | `tests/nixos/` | Basic service startup |
| NixOS full | `tests/nixos/` | Comprehensive VM tests |

See [Tests](./tests) for detailed test documentation.

---

## Related

- [Architecture Overview](../architecture/) - High-level design
- [Runtime Flows](../architecture/runtime-flows) - End-to-end flows
- [Tests](./tests) - Test coverage
