# core/os/modules/shell.nix
{
  pkgs,
  lib,
  config,
  ...
}:

let
  inherit (config.nixpi) primaryUser stateDir;
  primaryHome = "/home/${primaryUser}";
  inherit (config.nixpi.agent) piDir workspaceDir;
  nodeBinDir = "/usr/local/share/nixpi/node_modules/.bin";
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
    extraGroups = [
      "wheel"
      "networkmanager"
    ];
    home = primaryHome;
    createHome = true;
    shell = pkgs.bash;
  };

  users.groups.${primaryUser} = { };

  security.sudo.extraRules = lib.mkIf config.nixpi.security.passwordlessSudo.enable [
    {
      users = [ primaryUser ];
      commands = [
        {
          command = "ALL";
          options = [ "NOPASSWD" ];
        }
      ];
    }
  ];

  environment.etc = {
    "issue".text = "NixPI\n";
  };

  environment.sessionVariables = {
    NIXPI_DIR = workspaceDir;
    NIXPI_STATE_DIR = stateDir;
    NIXPI_PI_DIR = piDir;
    PI_CODING_AGENT_DIR = piDir;
    NIXPI_CONFIG_DIR = "${stateDir}/services";
    NIXPI_BOOTSTRAP_MODE = if config.nixpi.bootstrap.enable then "bootstrap" else "steady";
    NIXPI_KEEP_SSH_AFTER_SETUP = if config.nixpi.bootstrap.ssh.enable then "1" else "0";
  };

  programs.bash = {
    enable = true;
    loginShellInit = ''
      export PATH="${nodeBinDir}:$PATH"
    '';
    interactiveShellInit = ''
      if command -v chromium >/dev/null 2>&1; then
        export BROWSER="chromium"
      fi
      if [ -t 0 ]; then
        stty sane erase '^H' 2>/dev/null || true
      fi
      if [ -t 0 ] && [ -t 1 ] && command -v nixpi-launch-terminal-ui >/dev/null 2>&1; then
        nixpi-launch-terminal-ui || true
      fi
    '';
  };

  boot.kernel.sysctl."kernel.printk" = "4 4 1 7";
}
