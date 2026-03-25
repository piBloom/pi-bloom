# core/os/modules/options.nix
# Shared NixOS options consumed across NixPI modules.
{ lib, ... }:

let
  absolutePath = lib.types.pathWith { absolute = true; };
  # Absolute path that must not be a Nix store path (user-managed external state).
  externalAbsolutePath = lib.types.externalPath;
  mkPortOption = default: description:
    lib.mkOption {
      type = lib.types.port;
      inherit default description;
    };
in
{
  options.nixpi = {
    primaryUser = lib.mkOption {
      type = lib.types.str;
      default = "pi";
      description = ''
        Primary human/operator account for the NixPI machine.
      '';
    };

    stateDir = lib.mkOption {
      type = absolutePath;
      default = "/var/lib/nixpi";
      description = ''
        Root directory for service-owned NixPI state.
      '';
    };

    security = {
      fail2ban.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether fail2ban should protect SSH against brute-force attempts.
        '';
      };

      ssh.passwordAuthentication = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Whether SSH password authentication is enabled for the main NixPI
          host configuration.
        '';
      };

      ssh.allowUsers = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        description = ''
          Explicit SSH login allowlist. When empty, NixPI restricts SSH to the
          resolved primary operator account when one is available.
        '';
      };

      trustedInterface = lib.mkOption {
        type = lib.types.str;
        default = "wt0";
        description = ''
          Network interface trusted to reach the externally exposed NixPI
          service surface.
        '';
      };

      enforceServiceFirewall = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether NixPI service ports are opened only on the trusted interface.
        '';
      };

      passwordlessSudo.enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Deprecated blanket passwordless sudo escape hatch. Keep disabled in
          favor of narrow bootstrap rules and the broker service.
        '';
      };
    };

    bootstrap = {
      keepSshAfterSetup = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Whether SSH should remain reachable after first-boot setup
          completes. By default SSH is treated as a bootstrap-only path.
        '';
      };

      passwordlessSudo.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether NixPI grants narrow passwordless sudo rules needed by the
          first-boot bootstrap flow.
        '';
      };
    };

    agent = {
      autonomy = lib.mkOption {
        type = lib.types.enum [ "observe" "maintain" "admin" ];
        default = "maintain";
        description = ''
          Default privileged autonomy level granted to the always-on agent.
        '';
      };

      allowedUnits = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [
          "nixpi-daemon.service"
          "netbird.service"
          "nixpi-home.service"
          "nixpi-element-web.service"
          "continuwuity.service"
          "nixpi-update.service"
        ];
        description = ''
          Systemd units that the broker may operate on.
        '';
      };

      broker.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether the root-owned NixPI operations broker is enabled.
        '';
      };

      elevation.duration = lib.mkOption {
        type = lib.types.str;
        default = "30m";
        description = ''
          Default duration for a temporary admin elevation grant.
        '';
      };

      osUpdate.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether the broker may apply or roll back NixOS generations.
        '';
      };
    };

    services = {
      bindAddress = lib.mkOption {
        type = lib.types.str;
        default = "0.0.0.0";
        description = ''
          Bind address used by the built-in NixPI service surface.
        '';
      };

      home = {
        enable = lib.mkEnableOption "NixPI Home service" // { default = true; };
        port = mkPortOption 8080 "TCP port for the NixPI Home landing page.";
      };

      elementWeb = {
        enable = lib.mkEnableOption "NixPI Element Web service" // { default = true; };
        port = mkPortOption 8081 "TCP port for the NixPI Element Web client.";
      };

      secureWeb = {
        enable = lib.mkEnableOption "canonical HTTPS gateway for Home, Element Web, and Matrix" // { default = true; };
        port = mkPortOption 443 "TCP port for the canonical HTTPS NixPI entry point.";
      };
    };

    matrix = {
      bindAddress = lib.mkOption {
        type = lib.types.str;
        default = "0.0.0.0";
        description = ''
          Bind address used by the local Matrix homeserver listener.
        '';
      };

      port = mkPortOption 6167 "TCP port for the local Matrix homeserver.";

      clientBaseUrl = lib.mkOption {
        type = lib.types.str;
        default = "";
        description = ''
          Client-facing Matrix base URL used by Element Web and advertised to
          operators. When left empty, NixPI derives it from the hostname and
          configured Matrix port.
        '';
      };

      enableRegistration = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether Matrix account registration is enabled.
        '';
      };

      keepRegistrationAfterSetup = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Whether Matrix account registration should remain enabled after the
          first-boot setup completes.
        '';
      };

      maxUploadSize = lib.mkOption {
        type = lib.types.str;
        default = "20M";
        description = ''
          Maximum upload size accepted by the local Matrix homeserver.
        '';
      };

      registrationSharedSecretFile = lib.mkOption {
        type = lib.types.nullOr externalAbsolutePath;
        default = null;
        description = ''
          Optional external file containing the Matrix registration secret
          maintained for NixPI bootstrap compatibility. When unset, NixPI
          generates one stable runtime secret file.
        '';
      };

    };

    netbird = {
      apiTokenFile = lib.mkOption {
        type = lib.types.nullOr externalAbsolutePath;
        default = null;
        description = ''
          Path to a file containing the NetBird management API personal access
          token. When null, the provisioner and watcher services are not started.
          Never store the token in the Nix store.
        '';
      };

      apiEndpoint = lib.mkOption {
        type = lib.types.str;
        default = "https://api.netbird.io";
        description = ''
          Base URL for the NetBird management API. Override in tests to point
          at a mock server.
        '';
      };

      groups = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ "bloom-devices" "admins" "bloom-pi" ];
        description = ''
          NetBird groups to ensure exist. "All" is a NetBird built-in and must
          not appear here — the provisioner skips it automatically.
          "bloom-pi" is the group the Pi peer joins via its dedicated setup key;
          it is the destination group in all ACL policies (least-privilege).
        '';
      };

      setupKeys = lib.mkOption {
        type = lib.types.listOf (lib.types.submodule {
          options = {
            name       = lib.mkOption { type = lib.types.str; };
            autoGroups = lib.mkOption { type = lib.types.listOf lib.types.str; };
            ephemeral  = lib.mkOption { type = lib.types.bool; default = false; };
            usageLimit = lib.mkOption { type = lib.types.int;  default = 0; };
          };
        });
        default = [
          { name = "bloom-pi";     autoGroups = [ "bloom-pi" ];             ephemeral = false; usageLimit = 1; }
          { name = "bloom-device"; autoGroups = [ "bloom-devices" ];        ephemeral = false; usageLimit = 0; }
          { name = "admin-device"; autoGroups = [ "bloom-devices" "admins" ]; ephemeral = false; usageLimit = 0; }
        ];
        description = ''
          Setup keys to ensure exist in NetBird cloud. Keys are create-only —
          the NetBird API does not support mutating existing keys. To change a
          key's config, revoke it in the NetBird dashboard then re-run the
          provisioner (next nixos-rebuild switch or reboot).
        '';
      };

      policies = lib.mkOption {
        type = lib.types.listOf (lib.types.submodule {
          options = {
            name          = lib.mkOption { type = lib.types.str; };
            sourceGroup   = lib.mkOption { type = lib.types.str; };
            destGroup     = lib.mkOption { type = lib.types.str; };
            protocol      = lib.mkOption { type = lib.types.enum [ "tcp" "udp" "icmp" "all" ]; default = "tcp"; };
            ports         = lib.mkOption { type = lib.types.listOf lib.types.str; default = []; };
            postureChecks = lib.mkOption { type = lib.types.listOf lib.types.str; default = []; };
          };
        });
        default = [
          { name = "secure-web-access";  sourceGroup = "bloom-devices"; destGroup = "bloom-pi"; protocol = "tcp"; ports = [ "443" ]; postureChecks = []; }
          { name = "rdp-access";         sourceGroup = "admins";        destGroup = "bloom-pi"; protocol = "tcp"; ports = [ "3389" ]; postureChecks = []; }
          { name = "ssh-access";         sourceGroup = "admins";        destGroup = "bloom-pi"; protocol = "tcp"; ports = [ "22022" ]; postureChecks = []; }
        ];
        description = ''
          ACL policies to ensure exist. destGroup = "bloom-pi" targets only the
          Pi peer, ensuring policies apply least-privilege regardless of how
          many devices are enrolled.
        '';
      };

      postureChecks = lib.mkOption {
        type = lib.types.listOf (lib.types.submodule {
          options = {
            name       = lib.mkOption { type = lib.types.str; };
            minVersion = lib.mkOption { type = lib.types.str; };
          };
        });
        default = [ { name = "min-client-version"; minVersion = "0.61.0"; } ];
        description = ''
          Posture checks (minVersion only). Attach by name in policies.postureChecks.
          Other check types (geo, OS, process) are managed via the NetBird dashboard.
        '';
      };

      dns = {
        domain = lib.mkOption {
          type = lib.types.str;
          default = "bloom.local";
          description = "DNS domain routed through the Pi's NetBird IP by all peers in targetGroups.";
        };
        targetGroups = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ "bloom-devices" ];
          description = "Peer groups that receive the bloom.local DNS route via NetBird nameserver group.";
        };
        localForwarderPort = mkPortOption 22054 ''
          Port of NetBird's local DNS forwarder (default 22054 since v0.59.0).
          If the client uses a custom CustomDNSAddress, update this to match.
        '';
      };

      ssh = {
        enable = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = ''
            Whether to enable NetBird's built-in SSH daemon on the Pi (port 22022).
            Authentication uses NetBird peer identity (WireGuard key), not OIDC.
            Access is gated by the ssh-access ACL policy.
          '';
        };
        userMappings = lib.mkOption {
          type = lib.types.listOf (lib.types.submodule {
            options = {
              netbirdGroup = lib.mkOption { type = lib.types.str; };
              localUser    = lib.mkOption { type = lib.types.str; };
            };
          });
          default = [ { netbirdGroup = "admins"; localUser = "pi"; } ];
          description = "Maps a NetBird peer group to the local OS user an SSH session runs as. Update localUser to match your nixpi.primaryUser.";
        };
      };
    };

    update = {
      onBootSec = lib.mkOption {
        type = lib.types.str;
        default = "5min";
        description = ''
          Delay before the first automatic update check after boot.
        '';
      };

      interval = lib.mkOption {
        type = lib.types.str;
        default = "6h";
        description = ''
          Recurrence interval for the automatic update timer.
        '';
      };
    };

    timezone = lib.mkOption {
      type = lib.types.str;
      default = "UTC";
      description = ''
        System timezone. Any valid IANA timezone string (e.g. "Europe/Paris").
        Set interactively by the first-boot setup wizard.
      '';
    };

    keyboard = lib.mkOption {
      type = lib.types.str;
      default = "us";
      description = ''
        Console and X keyboard layout (e.g. "fr", "de", "us").
        Set interactively by the first-boot setup wizard.
      '';
    };
  };
}
