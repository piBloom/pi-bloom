{ ... }:

{
  imports = [
    ../../modules/common.nix
    ../../modules/proxmox-vm.nix
  ];

  networking.hostName = "edge";

  networking.interfaces.ens18.ipv4.addresses = [
    {
      address = "10.10.10.10";
      prefixLength = 24;
    }
  ];

  networking.defaultGateway = "10.10.10.1";
  networking.hosts."10.10.10.10" = [ "headscale.nazar.studio" ];
  networking.nameservers = [
    "1.1.1.1"
    "9.9.9.9"
  ];

  boot.kernel.sysctl = {
    "net.ipv4.ip_forward" = 1;
    "net.ipv6.conf.all.forwarding" = 1;
  };

  networking.firewall = {
    enable = true;
    checkReversePath = "loose";
    trustedInterfaces = [ "tailscale0" ];
    allowedTCPPorts = [
      22
      80
      443
    ];
  };

  services.tailscale = {
    enable = true;
    useRoutingFeatures = "server";
  };

  services.caddy = {
    enable = true;
    virtualHosts."nazar.studio".extraConfig = ''
      respond "Nazar edge is online\n"
    '';
    virtualHosts."www.nazar.studio".extraConfig = ''
      redir https://nazar.studio{uri} permanent
    '';
    virtualHosts."headscale.nazar.studio".extraConfig = ''
      reverse_proxy 10.10.10.11:8080
    '';
  };

  system.stateVersion = "25.11";
}
