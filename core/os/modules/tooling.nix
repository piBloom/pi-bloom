{ pkgs, lib, config, ... }:

let
  nixpiRebuild = pkgs.callPackage ../pkgs/nixpi-rebuild { }; # rebuild the installed /etc/nixos host flake
  nixpiRebuildPull = pkgs.callPackage ../pkgs/nixpi-rebuild-pull { }; # sync/rebuild the conventional /srv/nixpi operator checkout
in
{
  imports = [ ./options.nix ];

  environment.systemPackages = with pkgs; [
    git
    git-lfs
    gh
    nodejs
    ripgrep
    fd
    bat
    htop
    jq
    curl
    wget
    unzip
    openssl
    just
    shellcheck
    biome
    typescript
    qemu
    OVMF
    nixpiRebuild
    nixpiRebuildPull
  ] ++ lib.optionals config.nixpi.security.fail2ban.enable [ pkgs.fail2ban ];
}
