# core/os/modules/network.nix
{
  pkgs,
  lib,
  config,
  ...
}:

let
  primaryUser = config.nixpi.primaryUser;
  securityCfg = config.nixpi.security;
  bootstrapCfg = config.nixpi.bootstrap;
  netbirdCfg = config.nixpi.netbird;
  sshAllowUsers =
    if securityCfg.ssh.allowUsers != [ ] then
      securityCfg.ssh.allowUsers
    else
      lib.optional (primaryUser != "") primaryUser;
in

{
  imports = [ ./options.nix ];

  config = {
    assertions = [
      {
        assertion = securityCfg.trustedInterface != "";
        message = "nixpi.security.trustedInterface must not be empty.";
      }
    ];

    hardware.enableAllFirmware = true;

    services.openssh = {
      enable = bootstrapCfg.ssh.enable;
      openFirewall = false;
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

    networking.firewall.enable = true;
    networking.firewall.allowedTCPPorts = lib.optionals bootstrapCfg.ssh.enable [ 22 ];
    networking.useDHCP = lib.mkDefault false;
    networking.networkmanager.enable = true;
    services.resolved.enable = lib.mkIf netbirdCfg.enable true;
    services.netbird.clients.wt0 = lib.mkIf netbirdCfg.enable {
      login = {
        enable = true;
        setupKeyFile = netbirdCfg.setupKeyFile;
      };
      port = 51821;
      ui.enable = false;
      openFirewall = true;
      openInternalFirewall = true;
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

    systemd.tmpfiles.settings = {
      nixpi-workspace = {
        "${config.nixpi.agent.workspaceDir}".d = {
          mode = "2775";
          user = primaryUser;
          group = primaryUser;
        };
      };
    };

    environment.systemPackages = lib.optionals netbirdCfg.enable [ pkgs.netbird ];
  };
}
