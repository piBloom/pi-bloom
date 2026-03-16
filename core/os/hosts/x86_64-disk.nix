# core/os/hosts/x86_64-disk.nix — imported only for bare-metal / nixosConfigurations
{ ... }:

{
  disko.devices = import ../disk/x86_64-disk.nix;
}
