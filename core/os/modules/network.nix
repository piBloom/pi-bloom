# core/os/modules/network.nix
{ pkgs, lib, config, ... }:

let
  primaryUser = config.nixpi.primaryUser;
  primaryHome = "/home/${primaryUser}";
  stateDir = config.nixpi.stateDir;
  setupCompleteFile = "${primaryHome}/.nixpi/.setup-complete";
  cfg = config.nixpi.services;
  securityCfg = config.nixpi.security;
  sshAllowUsers =
    if securityCfg.ssh.allowUsers != [ ] then
      securityCfg.ssh.allowUsers
    else
      lib.optional (primaryUser != "") primaryUser;
  bindsLocally =
    cfg.bindAddress == "127.0.0.1"
    || cfg.bindAddress == "::1"
    || cfg.bindAddress == "localhost";
  exposedPorts =
    lib.optionals cfg.home.enable [ 80 ]
    ++
    lib.optionals cfg.home.enable [ cfg.home.port ]
    ++ lib.optionals cfg.elementWeb.enable [ cfg.elementWeb.port ]
    ++ [ config.nixpi.matrix.port ];
  preferWifi = pkgs.writeShellScriptBin "nixpi-prefer-wifi" ''
    set -euo pipefail

    if ! command -v nmcli >/dev/null 2>&1; then
      exit 0
    fi

    while IFS=: read -r uuid type; do
      [ -n "$uuid" ] || continue
      case "$type" in
        802-11-wireless)
          priority=100
          ;;
        802-3-ethernet)
          priority=-100
          ;;
        *)
          continue
          ;;
      esac

      current_priority="$(nmcli -g connection.autoconnect-priority connection show uuid "$uuid" 2>/dev/null || true)"
      current_autoconnect="$(nmcli -g connection.autoconnect connection show uuid "$uuid" 2>/dev/null || true)"
      if [ "$current_priority" = "$priority" ] && [ "$current_autoconnect" = "yes" ]; then
        continue
      fi

      nmcli connection modify uuid "$uuid" \
        connection.autoconnect yes \
        connection.autoconnect-priority "$priority" >/dev/null 2>&1 || true
    done < <(nmcli -t -f UUID,TYPE connection show 2>/dev/null || true)
  '';
in

{
  imports = [ ./options.nix ];

  config = {
    assertions = [
      {
        assertion = securityCfg.trustedInterface != "";
        message = "nixpi.security.trustedInterface must not be empty.";
      }
      {
        assertion = cfg.bindAddress != "";
        message = "nixpi.services.bindAddress must not be empty.";
      }
      {
        assertion = lib.length (lib.unique exposedPorts) == lib.length exposedPorts;
        message = "NixPI service ports must be unique across built-in services and Matrix.";
      }
    ];

    hardware.enableAllFirmware = true;
    services.netbird.enable = true;
    services.netbird.clients.default.config.DisableAutoConnect = lib.mkForce true;

    services.openssh = {
      enable = true;
      settings = {
        AllowAgentForwarding = false;
        AllowTcpForwarding = false;
        ClientAliveCountMax = 2;
        ClientAliveInterval = 300;
        LoginGraceTime = 30;
        MaxAuthTries = 3;
        PasswordAuthentication = securityCfg.ssh.passwordAuthentication;
        PubkeyAuthentication = "yes";
        PermitRootLogin = "no";
        X11Forwarding = false;
      };
      extraConfig = lib.optionalString (sshAllowUsers != [ ]) ''
        AllowUsers ${lib.concatStringsSep " " sshAllowUsers}
      '';
    };
    systemd.services.sshd.unitConfig = lib.mkIf (!config.nixpi.bootstrap.keepSshAfterSetup) {
      ConditionPathExists = "!${setupCompleteFile}";
    };

    networking.firewall.enable = true;
    networking.firewall.allowedTCPPorts = [ 22 ];
    networking.firewall.interfaces = lib.mkIf securityCfg.enforceServiceFirewall {
      "${securityCfg.trustedInterface}".allowedTCPPorts = exposedPorts;
    };
    networking.networkmanager.enable = true;

    systemd.services.nixpi-prefer-wifi = {
      description = "Prefer WiFi profiles over Ethernet in NetworkManager";
      after = [ "NetworkManager.service" ];
      wants = [ "NetworkManager.service" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        Type = "oneshot";
        ExecStart = "${preferWifi}/bin/nixpi-prefer-wifi";
      };
    };

    services.fail2ban = lib.mkIf securityCfg.fail2ban.enable {
      enable = true;
      jails.sshd.settings = {
        enabled = true;
        backend = "systemd";
        bantime = "1h";
        findtime = "10m";
        maxretry = 5;
      };
    };

    systemd.tmpfiles.rules = [
      "d ${primaryHome}/nixpi 2775 ${primaryUser} ${primaryUser} -"
    ];

    environment.systemPackages = with pkgs; [
      jq
      netbird
      preferWifi
    ];
    warnings =
      lib.optional (!securityCfg.enforceServiceFirewall && !bindsLocally) ''
        NixPI's built-in service surface is bound to `${cfg.bindAddress}` without
        the trusted-interface firewall restriction. Home, Element Web, and
        Matrix may be reachable on all network interfaces.
      '';
  };
}
