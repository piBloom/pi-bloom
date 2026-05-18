{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.nazar.access.tunnel;
  hostIdentity = import ../../fleet/host.nix;

  forwardType = lib.types.submodule {
    options = {
      bindAddress = lib.mkOption {
        type = lib.types.str;
        default = "127.0.0.1";
        description = "Local address to bind.";
      };
      localPort = lib.mkOption {
        type = lib.types.port;
        description = "Local port to open on the laptop.";
      };
      remoteHost = lib.mkOption {
        type = lib.types.str;
        default = "127.0.0.1";
        description = "Remote host as seen from Nazar.";
      };
      remotePort = lib.mkOption {
        type = lib.types.port;
        description = "Remote port on Nazar.";
      };
    };
  };

  forwardArgs = lib.concatMap (forward: [
    "-L"
    "${forward.bindAddress}:${toString forward.localPort}:${forward.remoteHost}:${toString forward.remotePort}"
  ]) cfg.forwards;

  sshArgs = lib.escapeShellArgs (
    [
      "-N"
      "-T"
      "-o"
      "ExitOnForwardFailure=yes"
      "-o"
      "ServerAliveInterval=30"
      "-o"
      "ServerAliveCountMax=3"
      "-o"
      "IdentitiesOnly=yes"
    ]
    ++ forwardArgs
    ++ [ cfg.sshHostAlias ]
  );
in
{
  options.nazar.access.tunnel = {
    enable = lib.mkEnableOption "SSH local port forwards to Nazar browser services";

    sshUser = lib.mkOption {
      type = lib.types.str;
      default = "alex";
      description = "Remote SSH user on Nazar.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = hostIdentity.public.ipv4;
      description = "Public Nazar SSH endpoint.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 22;
      description = "Remote SSH port on Nazar.";
    };

    keyPath = lib.mkOption {
      type = lib.types.str;
      default = "/home/alex/.ssh/id_ed25519";
      description = "Private key used for the tunnel.";
    };

    sshHostAlias = lib.mkOption {
      type = lib.types.str;
      default = "nazar-tunnel";
      description = "Generated OpenSSH host alias used by the tunnel service.";
    };

    hostPublicKey = lib.mkOption {
      type = lib.types.str;
      default = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHO8D1SwnjwFVj+bz/ITvENDLeskYUd8fUb+GIxW7Lay";
      description = "Nazar's OpenSSH host public key.";
    };

    forwards = lib.mkOption {
      type = lib.types.listOf forwardType;
      default = [
        {
          localPort = 9119;
          remotePort = 9119;
        }
      ];
      description = "Local TCP forwards opened by nazar-tunnel.service.";
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ pkgs.openssh ];

    programs.ssh.knownHosts.nazar-public = {
      hostNames = lib.unique [
        cfg.sshHostAlias
        cfg.host
      ];
      publicKey = cfg.hostPublicKey;
    };

    programs.ssh.extraConfig = ''
      Host ${cfg.sshHostAlias}
        HostName ${cfg.host}
        Port ${toString cfg.port}
        User ${cfg.sshUser}
        IdentityFile ${cfg.keyPath}
        IdentitiesOnly yes
        HostKeyAlias ${cfg.sshHostAlias}
        StrictHostKeyChecking yes
        BatchMode yes
        ServerAliveInterval 30
        ServerAliveCountMax 3
    '';

    systemd.services.nazar-tunnel = {
      description = "SSH local forwards to Nazar browser services";
      documentation = [
        "man:ssh(1)"
        "man:ssh_config(5)"
      ];
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];
      unitConfig = {
        ConditionPathExists = cfg.keyPath;
        StartLimitIntervalSec = 0;
      };
      serviceConfig = {
        Type = "simple";
        ExecStart = "${pkgs.openssh}/bin/ssh ${sshArgs}";
        Restart = "always";
        RestartSec = "10s";
      };
    };
  };
}
