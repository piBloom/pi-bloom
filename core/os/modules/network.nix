# core/os/modules/network.nix
{ lib, config, ... }:

let
  netLib = import ../lib/network.nix { inherit lib; };
  primaryUser = config.nixpi.primaryUser;
  securityCfg = config.nixpi.security;
  bootstrapCfg = config.nixpi.bootstrap;
  allowedSourceCIDRs = securityCfg.ssh.allowedSourceCIDRs;
  invalidAllowedSourceCIDRs = lib.filter (cidr: !(netLib.isValidSourceCIDR cidr)) allowedSourceCIDRs;
  sshAllowUsers =
    if securityCfg.ssh.allowUsers != [ ] then
      securityCfg.ssh.allowUsers
    else
      lib.optional (primaryUser != "") primaryUser;
  publicSshEnabled = bootstrapCfg.ssh.enable;
  ipv4AllowedSourceCIDRs = lib.filter (cidr: !(lib.hasInfix ":" cidr)) allowedSourceCIDRs;
  ipv6AllowedSourceCIDRs = lib.filter (cidr: lib.hasInfix ":" cidr) allowedSourceCIDRs;
  sshFirewallRules = lib.concatStringsSep "\n" (
    (map (cidr: "ip saddr ${cidr} tcp dport 22 accept") ipv4AllowedSourceCIDRs)
    ++ (map (cidr: "ip6 saddr ${cidr} tcp dport 22 accept") ipv6AllowedSourceCIDRs)
  );
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
        assertion = !securityCfg.ssh.passwordAuthentication;
        message = ''
          nixpi.security.ssh.passwordAuthentication must remain false. NixPI's
          public SSH model is key-only during both bootstrap and steady state.
        '';
      }
      {
        assertion = !bootstrapCfg.ssh.enable || allowedSourceCIDRs != [ ];
        message = "nixpi.security.ssh.allowedSourceCIDRs must be set when bootstrap SSH is enabled.";
      }
      {
        assertion = !publicSshEnabled || allowedSourceCIDRs != [ ];
        message = "nixpi.security.ssh.allowedSourceCIDRs must be set when public SSH is enabled.";
      }
      {
        assertion = !(publicSshEnabled && lib.elem 22 config.networking.firewall.allowedTCPPorts);
        message = ''
          Port 22 must not be opened through networking.firewall.allowedTCPPorts when NixPI public SSH is enabled.
          Use nixpi.security.ssh.allowedSourceCIDRs so SSH stays scoped to the intended admin CIDRs.
        '';
      }
      {
        assertion = invalidAllowedSourceCIDRs == [ ];
        message = ''
          nixpi.security.ssh.allowedSourceCIDRs contains invalid CIDR entries:
          ${lib.concatStringsSep ", " invalidAllowedSourceCIDRs}
        '';
      }
    ];

    hardware.enableRedistributableFirmware = lib.mkDefault true;

    services.openssh = {
      enable = lib.mkDefault publicSshEnabled;
      openFirewall = false;
      settings = {
        AllowAgentForwarding = false;
        AllowTcpForwarding = false;
        ClientAliveCountMax = 2;
        ClientAliveInterval = 300;
        LoginGraceTime = 30;
        MaxAuthTries = 3;
        PasswordAuthentication = false;
        PubkeyAuthentication = "yes";
        PermitRootLogin = "no";
        X11Forwarding = false;
      };
      extraConfig = lib.optionalString (sshAllowUsers != [ ]) ''
        AllowUsers ${lib.concatStringsSep " " sshAllowUsers}
      '';
    };

    networking.nftables.enable = true;
    networking.firewall = {
      enable = true;
      allowedTCPPorts = [ ];
      extraInputRules = lib.optionalString publicSshEnabled sshFirewallRules;
    };
    networking.useDHCP = lib.mkDefault false;
    networking.networkmanager.enable = true;

    services.fail2ban = lib.mkIf securityCfg.fail2ban.enable {
      enable = true;
      ignoreIP = allowedSourceCIDRs;
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
  };
}
