{ lib, config, ... }:

{
  options.nixpi.agent = {
    autonomy = lib.mkOption {
      type = lib.types.enum [
        "observe"
        "maintain"
        "admin"
      ];
      default = "maintain";
      description = ''
        Default privileged autonomy level granted to the always-on agent.
      '';
    };

    allowedUnits = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [
        "netbird-wt0.service"
        "nixpi-update.service"
      ];
      description = ''
        Systemd units that the broker may operate on.
      '';
    };

    broker.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether the root-owned NixPI operations broker is enabled.
      '';
    };

    elevation.duration = lib.mkOption {
      type = lib.types.str;
      default = "30m";
      description = ''
        Default duration for a temporary admin elevation grant.
      '';
    };

    osUpdate.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether the broker may apply or roll back NixOS generations.
      '';
    };

    packagePaths = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ "/usr/local/share/nixpi" ];
      description = ''
        List of package root paths passed to the Pi agent's settings.json
        "packages" field. The Pi agent loads extensions and skills from each
        path. The default points to the stable runtime symlink created by
        systemd-tmpfiles.
      '';
    };

    piDir = lib.mkOption {
      type = lib.types.str;
      description = ''
        Declarative Pi runtime directory exported as NIXPI_PI_DIR and
        PI_CODING_AGENT_DIR.
      '';
    };

    workspaceDir = lib.mkOption {
      type = lib.types.str;
      description = ''
        Root directory for the Pi agent workspace (Objects, Episodes, Skills,
        Persona, etc.). Propagated as NIXPI_DIR to the shell environment and
        approved NixPI systemd services.
      '';
    };
  };

  config.nixpi.agent = {
    piDir = lib.mkDefault "/home/${config.nixpi.primaryUser}/.pi";
    workspaceDir = lib.mkDefault "/home/${config.nixpi.primaryUser}/nixpi";
  };
}
