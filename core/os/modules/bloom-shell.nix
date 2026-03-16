# core/os/modules/bloom-shell.nix
{ pkgs, lib, ... }:

let
  bashrc = pkgs.writeText "bloom-bashrc" ''
    export BLOOM_DIR="$HOME/Bloom"
    export XDG_RUNTIME_DIR="/run/user/$(id -u)"
    export BROWSER="chromium"
    export PATH="/usr/local/share/bloom/node_modules/.bin:$PATH"
  '';

  bashProfile = pkgs.writeText "bloom-bash_profile" ''
    # Source .bashrc for env vars (BLOOM_DIR, PATH, etc.)
    [ -f ~/.bashrc ] && . ~/.bashrc

    # First-boot wizard (runs once, before Pi)
    if [ -t 0 ] && [ ! -f "$HOME/.bloom/.setup-complete" ]; then
      bloom-wizard.sh
    fi

    # Start Pi on interactive login (only after setup, only one instance — atomic mkdir lock)
    if [ -t 0 ] && [ -f "$HOME/.bloom/.setup-complete" ] && [ -z "$PI_SESSION" ] && mkdir /tmp/.bloom-pi-session 2>/dev/null; then
      trap 'rmdir /tmp/.bloom-pi-session 2>/dev/null' EXIT
      export PI_SESSION=1
      bloom-greeting.sh
      exec pi
    fi
  '';
in
{
  users.users.pi = {
    isNormalUser = true;
    group = "pi";
    extraGroups = [ "wheel" "networkmanager" "podman" ];
    home = "/home/pi";
    shell = pkgs.bash;
    # Default password for first-boot SSH access; setup wizard prompts to change it.
    initialPassword = "bloom";
  };
  users.groups.pi = {};

  security.sudo.extraRules = [
    {
      users = [ "pi" ];
      commands = [ { command = "ALL"; options = [ "NOPASSWD" ]; } ];
    }
  ];

  services.getty.autologinUser = lib.mkForce "pi";

  systemd.services."serial-getty@ttyS0" = {
    overrideStrategy = "asDropin";
    serviceConfig.ExecStart = lib.mkForce [
      ""
      "${pkgs.util-linux}/sbin/agetty --autologin pi --keep-baud 115200,57600,38400,9600 ttyS0 $TERM"
    ];
  };

  environment.etc = {
    "skel/.bashrc".source = bashrc;
    "skel/.bash_profile".source = bashProfile;
    "issue".text = "Bloom OS\n";
  };

  systemd.tmpfiles.rules = [
    "C /home/pi/.bashrc      0644 pi pi - /etc/skel/.bashrc"
    "C /home/pi/.bash_profile 0644 pi pi - /etc/skel/.bash_profile"
  ];

  boot.kernel.sysctl."kernel.printk" = "4 4 1 7";

  networking.hostName = lib.mkDefault "bloom";
}
