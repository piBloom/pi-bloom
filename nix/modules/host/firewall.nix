{ fleet, ... }:
let
  minecraft = fleet.vms.minecraft;
  mcPort = minecraft.minecraft.port or 25565;
  mcVoicePort = minecraft.minecraft.voiceChatPort or 24454;
in
{
  networking.nftables.enable = true;

  networking.firewall = {
    enable = true;
    allowPing = true;
    checkReversePath = "loose";

    # Public OpenSSH stays open in nix/modules/host/ssh.nix as a hardened
    # alex-only, key-only break-glass path. Public WireGuard is opened in
    # nix/modules/host/wireguard.nix. All application services stay private to
    # wg0 except the approved Minecraft game/voice DNAT below.
    allowedTCPPorts = [ ];
    allowedUDPPorts = [ ];

    extraForwardRules = ''
      # Let MicroVMs initiate egress and reply traffic through the host.
      ip saddr 10.10.10.0/24 accept
      ip daddr 10.10.10.0/24 ct state established,related accept

      # Approved public Balaur exposure: Minecraft game traffic only. There is
      # intentionally no public TCP/80 web DNAT to the Minecraft MicroVM.
      iifname "enp0s31f6" ip daddr ${minecraft.ip} tcp dport ${toString mcPort} accept
      iifname "enp0s31f6" ip daddr ${minecraft.ip} udp dport ${toString mcVoicePort} accept
    '';
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
