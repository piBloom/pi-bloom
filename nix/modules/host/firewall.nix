{
  fleet,
  lib,
  pkgs,
  ...
}:
let
  privateIp = "10.44.0.1";
  minecraft = fleet.vms.minecraft;
  mcPort = minecraft.minecraft.port or 25565;
  mcVoicePort = minecraft.minecraft.voiceChatPort or 24454;
  microvmTapNames = map (vm: vm.microvm.tap) (lib.attrValues fleet.vms);
  microvmTapSet = "{ ${lib.concatStringsSep ", " (map (tap: "\"${tap}\"") microvmTapNames)} }";
in
{
  networking.nftables = {
    enable = true;
    tables.nazar-microvm-host-guard = {
      family = "inet";
      content = ''
        chain input {
          type filter hook input priority -10; policy accept;

          # Enforce one-way host management: Nazar may open connections to
          # MicroVMs, but MicroVMs may not open new connections to Nazar.
          # Replies to host-initiated SSH/deploy sessions remain allowed.
          ct state established,related accept
          iifname ${microvmTapSet} ip saddr 10.10.10.0/24 reject with icmp type admin-prohibited
          iifname ${microvmTapSet} meta nfproto ipv6 reject with icmpv6 type admin-prohibited
        }
      '';
    };
  };

  networking.firewall = {
    enable = true;
    allowPing = true;
    checkReversePath = "loose";

    # Public OpenSSH stays open in nix/modules/host/ssh.nix as a hardened
    # alex-only, key-only sshuttle control endpoint. All application services
    # stay private on the host-local private address except the approved
    # Minecraft game/voice DNAT below.
    allowedTCPPorts = [ ];
    allowedUDPPorts = [ ];

    # No VM-to-host firewall exceptions. VMs cannot reach host SSH;
    # host-initiated SSH to VMs relies on established/related reply traffic.
    interfaces = { };

    extraForwardRules = ''
      # Let MicroVMs initiate egress and reply traffic through the host.
      ip saddr 10.10.10.0/24 accept
      ip daddr 10.10.10.0/24 ct state established,related accept

      # Approved public Minecraft exposure: game traffic only. There is
      # intentionally no public TCP/80 web DNAT to the Minecraft MicroVM.
      iifname "enp0s31f6" ip daddr ${minecraft.ip} tcp dport ${toString mcPort} accept
      iifname "enp0s31f6" ip daddr ${minecraft.ip} udp dport ${toString mcVoicePort} accept
    '';
  };

  systemd.services.minecraft-game-proxy = {
    description = "Private Minecraft TCP proxy to the Minecraft MicroVM";
    after = [
      "network-online.target"
      "microvm@minecraft.service"
    ];
    wants = [
      "network-online.target"
      "microvm@minecraft.service"
    ];
    wantedBy = [ "multi-user.target" ];
    path = [ pkgs.socat ];
    serviceConfig = {
      ExecStart = "${pkgs.socat}/bin/socat TCP-LISTEN:${toString mcPort},bind=${privateIp},reuseaddr,fork TCP:${minecraft.ip}:${toString mcPort}";
      Restart = "always";
      RestartSec = "5s";
    };
  };

  networking.nat = {
    enable = true;
    externalInterface = "enp0s31f6";
    externalIP = "167.235.12.22";
    internalIPs = [ "10.10.10.0/24" ];
    forwardPorts = [
      {
        sourcePort = mcPort;
        destination = "${minecraft.ip}:${toString mcPort}";
        proto = "tcp";
      }
      {
        sourcePort = mcVoicePort;
        destination = "${minecraft.ip}:${toString mcVoicePort}";
        proto = "udp";
      }
    ];
  };

  boot.kernel.sysctl = {
    "net.ipv4.ip_forward" = true;
    "net.ipv6.conf.all.forwarding" = false;
  };

  assertions = [
    {
      assertion = minecraft.service == "minecraft";
      message = "nix/modules/host/firewall.nix expected fleet.vms.minecraft to be the Minecraft service.";
    }
  ];
}
