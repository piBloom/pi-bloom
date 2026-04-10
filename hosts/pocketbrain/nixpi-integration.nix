{ nixpi, ... }:
{
  imports = [
    nixpi.nixosModules.nixpi
    ./nixpi-host.nix
  ];
}
