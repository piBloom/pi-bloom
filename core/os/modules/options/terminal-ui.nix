{ lib, ... }:

{
  options.nixpi.terminal = {
    interface = lib.mkOption {
      type = lib.types.enum [
        "plain-shell"
        "zellij"
      ];
      default = "plain-shell";
      description = ''
        Default operator-facing terminal interface for SSH and local tty sessions.
      '';
    };

    zellij = {
      enable = lib.mkEnableOption "Zellij as the default NixPI terminal UI" // {
        default = false;
      };

      packageMode = lib.mkOption {
        type = lib.types.enum [
          "nixpkgs"
          "native-patched"
        ];
        default = "nixpkgs";
        description = ''
          Package source for Zellij. `native-patched` is reserved for a future
          in-repo build that patches plugins from source.
        '';
      };

      autoStartOn = lib.mkOption {
        type = lib.types.listOf (lib.types.enum [ "ssh" "tty" ]);
        default = [ "ssh" "tty" ];
        description = ''
          Interactive session types that should auto-enter Zellij.
        '';
      };

      attachExistingSession = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether the launcher should attach to an existing session name before
          creating a new one.
        '';
      };

      exitShellOnExit = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Whether the shell should exit when Zellij exits after being auto-launched.
        '';
      };

      bypassEnvVar = lib.mkOption {
        type = lib.types.str;
        default = "NIXPI_NO_ZELLIJ";
        description = ''
          Environment variable that skips Zellij auto-start when set to a non-empty value.
        '';
      };

      piLayout = {
        enable = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = ''
            Whether the generated default Zellij layout should include a Pi tab.
          '';
        };

        name = lib.mkOption {
          type = lib.types.str;
          default = "nixpi";
          description = ''
            Name of the generated default layout file.
          '';
        };
      };
    };
  };
}
