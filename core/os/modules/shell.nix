# core/os/modules/shell.nix
{ pkgs, lib, config, ... }:

let
  resolved = import ../lib/resolve-primary-user.nix { inherit lib config; };
  primaryUser = resolved.resolvedPrimaryUser;
  primaryHome = resolved.resolvedPrimaryHome;
  serviceUser = config.nixpi.serviceUser;
  stateDir = config.nixpi.stateDir;

  bashrc = pkgs.writeText "nixpi-bashrc" ''
    export NIXPI_DIR="${primaryHome}/nixpi"
    export NIXPI_STATE_DIR="${stateDir}"
    export NIXPI_PI_DIR="${stateDir}/agent"
    export PI_CODING_AGENT_DIR="${stateDir}/agent"
    export NIXPI_CONFIG_DIR="${stateDir}/services"
    export NIXPI_INSTALL_MODE="${config.nixpi.install.mode}"
    export NIXPI_KEEP_SSH_AFTER_SETUP="${if config.nixpi.bootstrap.keepSshAfterSetup then "1" else "0"}"
    if command -v chromium >/dev/null 2>&1; then
      export BROWSER="chromium"
    fi
    export PATH="/usr/local/share/nixpi/node_modules/.bin:$PATH"
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
    {
      assertion = primaryHome != "";
      message = "nixpi.primaryHome must not be empty.";
    }
    {
      assertion = serviceUser != "";
      message = "nixpi.serviceUser must not be empty.";
    }
    {
      assertion = serviceUser != primaryUser;
      message = "nixpi.serviceUser must be distinct from nixpi.primaryUser.";
    }
    {
      assertion = config.nixpi.install.mode != "managed-user" || primaryUser != "";
      message = "nixpi.install.mode = managed-user requires nixpi.primaryUser.";
    }
  ];

  users.users.${primaryUser} = lib.mkMerge [
    (lib.mkIf (config.nixpi.createPrimaryUser || config.nixpi.install.mode == "managed-user") {
      isNormalUser = true;
      group = primaryUser;
      extraGroups = [ "wheel" "networkmanager" serviceUser ];
      home = primaryHome;
      createHome = true;
      shell = pkgs.bash;
    })
    (lib.mkIf (!(config.nixpi.createPrimaryUser || config.nixpi.install.mode == "managed-user")) {
      extraGroups = lib.mkAfter [ serviceUser ];
    })
  ];

  users.groups.${primaryUser} = lib.mkIf (config.nixpi.createPrimaryUser || config.nixpi.install.mode == "managed-user") {};

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
