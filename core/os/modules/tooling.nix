{ pkgs, lib, config, ... }:

{
  imports = [ ./options.nix ];

  environment.systemPackages = with pkgs; [
    git
    git-lfs
    gh
    codex
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
  ] ++ lib.optionals config.nixpi.security.fail2ban.enable [ pkgs.fail2ban ];
}
