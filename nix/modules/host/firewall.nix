{ fleet, lib, ... }:
let
  minecraft = fleet.vms.minecraft;
  minecraftWebPorts = minecraft.webPorts or [ 80 ];
  mcPort = minecraft.minecraft.port or 25565;
  mcVoicePort = minecraft.minecraft.voiceChatPort or 24454;
in
{
  networking.nftables.enable = true;

  networking.firewall = {
    enable = true;
    allowPing = true;
    checkReversePath = "loose";

    # Most public host services stay closed here. Public OpenSSH is deliberately
    # opened in nix/modules/host/ssh.nix for alex-only key-based access; root SSH
    # is disabled. Public Minecraft is DNATed to the Minecraft MicroVM below, not
    # accepted as host-local INPUT traffic.
    allowedTCPPorts = [ ];
    allowedUDPPorts = [ ];

    extraForwardRules = ''
      # Let MicroVMs initiate egress and reply traffic through the host.
      ip saddr 10.10.10.0/24 accept
      ip daddr 10.10.10.0/24 ct state established,related accept

      # Approved public Balaur exposure: the small website plus Minecraft game
      # traffic are DNATed to the Minecraft MicroVM. Administration is SSH-only
      # as alex on the host, then private NAT aliases from nazar.
      ${lib.concatMapStringsSep "\n      " (
        port: ''iifname "enp0s31f6" ip daddr ${minecraft.ip} tcp dport ${toString port} accept''
      ) minecraftWebPorts}
      iifname "enp0s31f6" ip daddr ${minecraft.ip} tcp dport ${toString mcPort} accept
      iifname "enp0s31f6" ip daddr ${minecraft.ip} udp dport ${toString mcVoicePort} accept
    '';
  };

  networking.nat = {
    enable = true;
    externalInterface = "enp0s31f6";
    externalIP = "167.235.12.22";
    internalIPs = [ "10.10.10.0/24" ];
    forwardPorts =
      (map (port: {
        sourcePort = port;
        destination = "${minecraft.ip}:${toString port}";
        proto = "tcp";
      }) minecraftWebPorts)
      ++ [
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
