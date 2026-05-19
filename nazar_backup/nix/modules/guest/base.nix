{ pkgs, ... }:
{
  nix.settings = {
    experimental-features = [
      "nix-command"
      "flakes"
    ];
    # `alex` is a passwordless-sudo wheel admin on VMs. Trust wheel for Nix so
    # plain nixos-rebuild/VM-local switches can build and activate as needed.
    trusted-users = [
      "root"
      "@wheel"
    ];
  };

  time.timeZone = "Europe/Bucharest";
  i18n.defaultLocale = "en_US.UTF-8";

  environment.systemPackages = with pkgs; [
    curl
    git
    htop
    jq
    rsync
    tmux
    vim
    wget
  ];

  documentation.nixos.enable = false;
}
