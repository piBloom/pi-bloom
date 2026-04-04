{ ... }:

{
  imports = [
    ./options.nix
    ./network.nix
    ./update.nix
    ./runtime.nix
    ./collab.nix
    ./tooling.nix
    ./shell.nix
    ./firstboot
    ./ttyd.nix
    ./setup-apply.nix
  ];
}
