{ ... }:

{
  imports = [
    ./options.nix
    ./setup.nix
    ./network.nix
    ./update.nix
    ./runtime.nix
    ./collab.nix
    ./tooling.nix
    ./shell.nix
    ./firstboot
    ./desktop-xfce.nix
  ];
}
