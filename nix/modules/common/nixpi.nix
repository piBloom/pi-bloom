# DEPRECATED: This module is no longer imported by default.
# NixPi now runs centrally on the host with multi-workspace support.
# This file is kept for reference or standalone VM nixpi deployments.
{
  fleet,
  inputs,
  pkgs,
  vm,
  ...
}:
let
  pi = pkgs.callPackage ../../packages/pi { };
  gateway = fleet.defaults.gateway;
  repoName =
    {
      git = "nazar";
      minecraft = "minecraft";
      dav-server = "dav-server";
    }
    .${vm.hostname} or vm.hostname;
  repoRoot = "/home/alex/${repoName}";
  nixpi = vm.nixpi or { };
in
{
  imports = [ inputs.nixpi.nixosModules.nixpi ];

  services.nixpi = {
    enable = true;
    user = "alex";
    group = "users";
    home = "/home/alex";
    workingDirectory = nixpi.workingDirectory or repoRoot;
    host = "0.0.0.0";
    port = nixpi.port or 4815;
    piBinary = "${pi}/bin/pi";
    openFirewall = true;
    firewallAllowedSources = [ gateway ];
  };

  # NixPi spawns `node` for its RPC/web worker path; keep that executable in
  # the unit PATH in addition to the wrapped entrypoint's absolute Node path.
  systemd.services.nixpi = {
    path = [ pkgs.nodejs_22 ];
    environment.NPM_CONFIG_PREFIX = "/home/alex/.pi/npm-global";
  };
}
