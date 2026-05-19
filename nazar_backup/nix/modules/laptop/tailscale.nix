{
  config,
  lib,
  ...
}:
{
  services.tailscale = {
    enable = true;
    openFirewall = true;
    useRoutingFeatures = lib.mkDefault "client";
  };

  assertions = [
    {
      assertion = config.services.tailscale.useRoutingFeatures == "client";
      message = "alex-laptop should use Tailscale in client mode only unless subnet-router/exit-node behavior is explicitly requested.";
    }
  ];
}
