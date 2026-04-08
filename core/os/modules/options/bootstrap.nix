{ lib, config, ... }:

let
  cfg = config.nixpi.bootstrap;
in
{
  options.nixpi.bootstrap = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Whether the system is intentionally configured in bootstrap mode.
        Bootstrap mode is declarative: it enables the temporary operator
        affordances that are needed before the host is locked down.
      '';
    };

    ssh.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Whether SSH should be exposed for the selected NixPI system state.
        Defaults to the bootstrap mode when not set explicitly.
      '';
    };

    temporaryAdmin.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Whether the primary operator receives the declarative bootstrap-time
        passwordless sudo grant. Defaults to the bootstrap mode when not set
        explicitly.
      '';
    };
  };

  config.nixpi.bootstrap = {
    ssh.enable = lib.mkDefault cfg.enable;
    temporaryAdmin.enable = lib.mkDefault cfg.enable;
  };
}
