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
}
