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
  wgCfg = config.nixpi.wireguard;
  sshAllowUsers =
    if securityCfg.ssh.allowUsers != [ ] then
      securityCfg.ssh.allowUsers
    else
      lib.optional (primaryUser != "") primaryUser;
  wireguardPeers = map (
    peer:
    {
      inherit (peer) name publicKey;
      allowedIPs = peer.allowedIPs;
    }
    // lib.optionalAttrs (peer.endpoint != null) { endpoint = peer.endpoint; }
    // lib.optionalAttrs (peer.presharedKeyFile != null) { presharedKeyFile = peer.presharedKeyFile; }
    // lib.optionalAttrs (peer.persistentKeepalive != null) { persistentKeepalive = peer.persistentKeepalive; }
    // lib.optionalAttrs (peer.dynamicEndpointRefreshSeconds != null) {
      dynamicEndpointRefreshSeconds = peer.dynamicEndpointRefreshSeconds;
    }
  ) wgCfg.peers;
  wireguardSecretDirs =
    lib.unique (
      map builtins.dirOf (
        [ wgCfg.privateKeyFile ] ++ lib.filter (path: path != null) (map (peer: peer.presharedKeyFile) wgCfg.peers)
      )
    );
in

{
  imports = [ ./options.nix ];

  config = lib.mkMerge [
    {
      assertions = [
        {
          assertion = securityCfg.trustedInterface != "";
          message = "nixpi.security.trustedInterface must not be empty.";
        }
      ];

      hardware.enableAllFirmware = true;

      services.openssh = {
        enable = bootstrapCfg.ssh.enable;
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
      networking.firewall.allowedUDPPorts = lib.optionals wgCfg.enable [ wgCfg.listenPort ];
      networking.useDHCP = lib.mkDefault false;
      networking.networkmanager.enable = true;
      networking.wireguard.interfaces = lib.mkIf wgCfg.enable {
        "${wgCfg.interface}" = {
          ips = [ wgCfg.address ];
          listenPort = wgCfg.listenPort;
          privateKeyFile = wgCfg.privateKeyFile;
          generatePrivateKeyFile = wgCfg.generatePrivateKeyFile;
          peers = wireguardPeers;
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

      systemd.tmpfiles.settings = {
        nixpi-workspace = {
          "${config.nixpi.agent.workspaceDir}".d = {
            mode = "2775";
            user = primaryUser;
            group = primaryUser;
          };
        };
      } // lib.optionalAttrs wgCfg.enable {
        nixpi-wireguard = lib.genAttrs wireguardSecretDirs (dir: {
          d = {
            mode = "0700";
            user = "root";
            group = "root";
          };
        });
      };

      environment.systemPackages = with pkgs; [
        jq
      ] ++ lib.optionals wgCfg.enable [ wireguard-tools ];
    }
  ];
}
