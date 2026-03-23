# core/os/modules/shell.nix
{ pkgs, lib, config, ... }:

let
  primaryUser = config.nixpi.primaryUser;
  primaryHome = "/home/${primaryUser}";
  stateDir = config.nixpi.stateDir;

  bashrc = pkgs.writeText "nixpi-bashrc" ''
    export NIXPI_DIR="${primaryHome}/nixpi"
    export NIXPI_STATE_DIR="${stateDir}"
    export NIXPI_PI_DIR="${primaryHome}/.pi"
    export PI_CODING_AGENT_DIR="${primaryHome}/.pi"
    export NIXPI_CONFIG_DIR="${stateDir}/services"
    export NIXPI_KEEP_SSH_AFTER_SETUP="${if config.nixpi.bootstrap.keepSshAfterSetup then "1" else "0"}"
    if command -v chromium >/dev/null 2>&1; then
      export BROWSER="chromium"
    fi
    export PATH="/usr/local/share/nixpi/node_modules/.bin:$PATH"
    if [ -t 0 ]; then
      stty sane erase '^H' 2>/dev/null || true
    fi
  '';

  bashProfile = pkgs.writeText "nixpi-bash_profile" ''
    [ -f ~/.bashrc ] && . ~/.bashrc
  '';
in
{
  imports = [ ./options.nix ];

  assertions = [
    {
      assertion = primaryUser != "";
      message = "nixpi.primaryUser must resolve to a real human user. Set `nixpi.primaryUser` explicitly.";
    }
  ];

  users.users.${primaryUser} = {
    isNormalUser = true;
    group = primaryUser;
    extraGroups = [ "wheel" "networkmanager" ];
    home = primaryHome;
    createHome = true;
    shell = pkgs.bash;
  };

  users.groups.${primaryUser} = {};

  security.sudo.extraRules = lib.mkIf config.nixpi.security.passwordlessSudo.enable [
    {
      users = [ primaryUser ];
      commands = [ { command = "ALL"; options = [ "NOPASSWD" ]; } ];
    }
  ];

  environment.etc = {
    "skel/.bashrc".source = bashrc;
    "skel/.bash_profile".source = bashProfile;
    "issue".text = "NixPI\n";
  };

  system.activationScripts.nixpi-shell = lib.stringAfter [ "users" ] ''
    primary_group="$(id -gn ${primaryUser})"
    install -d -m 0755 -o ${primaryUser} -g "$primary_group" ${primaryHome}

    if [ ! -e ${primaryHome}/.bashrc ]; then
      install -m 0644 -o ${primaryUser} -g "$primary_group" /etc/skel/.bashrc ${primaryHome}/.bashrc
    fi

    if [ ! -e ${primaryHome}/.bash_profile ]; then
      install -m 0644 -o ${primaryUser} -g "$primary_group" /etc/skel/.bash_profile ${primaryHome}/.bash_profile
    fi
  '';

  boot.kernel.sysctl."kernel.printk" = "4 4 1 7";
}
