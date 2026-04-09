# core/os/modules/shell.nix
{
  pkgs,
  lib,
  config,
  ...
}:

let
  inherit (config.nixpi) allowPrimaryUserChange primaryUser stateDir;
  primaryHome = "/home/${primaryUser}";
  inherit (config.nixpi.agent) piDir workspaceDir;
  nodeBinDir = "${builtins.head config.nixpi.agent.packagePaths}/node_modules/.bin";
  primaryUserMarker = "${stateDir}/primary-user";
in
{
  imports = [ ./options.nix ];

  config = {
    assertions = [
      {
        assertion = primaryUser != "";
        message = "nixpi.primaryUser must resolve to a real human user. Set `nixpi.primaryUser` explicitly.";
      }
    ];

    system.activationScripts."00-nixpi-primary-user-guard" = {
      deps = [ "specialfs" ];
      supportsDryActivation = true;
      text = ''
        marker=${lib.escapeShellArg primaryUserMarker}
        expected_user=${lib.escapeShellArg primaryUser}

        install -d -m 0700 ${lib.escapeShellArg stateDir}

        if [ ! -e "$marker" ]; then
          printf '%s\n' "$expected_user" > "$marker"
          chmod 0600 "$marker"
        else
          current_user="$(cat "$marker")"
        fi

        if [ -n "''${current_user:-}" ] && [ "$current_user" != "$expected_user" ] && [ "${if allowPrimaryUserChange then "1" else "0"}" = "1" ]; then
          printf '%s\n' "$expected_user" > "$marker"
          chmod 0600 "$marker"
        fi

        if [ -n "''${current_user:-}" ] && [ "$current_user" != "$expected_user" ] && [ "${if allowPrimaryUserChange then "1" else "0"}" != "1" ]; then
          echo "Refusing to change nixpi.primaryUser from '$current_user' to '$expected_user'." >&2
          echo "Set nixpi.allowPrimaryUserChange = true for one rebuild if this migration is intentional." >&2
          false
        fi
      '';
    };

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
      '';
    };

    boot.kernel.sysctl."kernel.printk" = "4 4 1 7";
  };
}
