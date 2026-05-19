{
  config,
  lib,
  ...
}:
let
  tailnetInterface = "tailscale0";
in
{
  services.tailscale = {
    enable = true;

    # Opens Tailscale's own firewall needs without exposing Nazar's HTTP/DAV
    # services on the public interface.
    openFirewall = true;

    # Nazar should join the tailnet as a normal client, not as a subnet router
    # or exit node, unless that is explicitly designed later.
    useRoutingFeatures = lib.mkDefault "client";
  };

  networking.firewall.interfaces.${tailnetInterface}.allowedTCPPorts = [
    # Private HTTP(S) entrypoint for DAV/dashboard once private vhosts exist.
    80
    443
  ];

  assertions = [
    {
      assertion = !(builtins.elem tailnetInterface (config.networking.firewall.trustedInterfaces or [ ]));
      message = "Do not mark tailscale0 as a fully trusted firewall interface; expose only explicit private ports.";
    }
  ];
}
