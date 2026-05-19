{ pkgs, ... }:
{
  nix.settings = {
    experimental-features = [
      "nix-command"
      "flakes"
    ];
    trusted-users = [
      "root"
      "alex"
      "@wheel"
    ];
    auto-optimise-store = true;
  };

  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 14d";
  };

  time.timeZone = "Europe/Bucharest";
  i18n.defaultLocale = "en_US.UTF-8";

  environment.systemPackages = with pkgs; [
    curl
    gh
    git
    htop
    iproute2
    jq
    mdadm
    nftables
    pciutils
    rsync
    smartmontools
    tmux
    vim
    wget
  ];

  boot.tmp.cleanOnBoot = true;
  services.fstrim.enable = true;
  documentation.nixos.enable = false;
}
