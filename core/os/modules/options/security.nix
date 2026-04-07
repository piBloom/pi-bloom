{ lib, ... }:

{
  options.nixpi.security = {
    fail2ban.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether fail2ban should protect SSH against brute-force attempts.
      '';
    };

    ssh.passwordAuthentication = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Whether SSH password authentication is enabled for the main NixPI
        host configuration.
      '';
    };

    ssh.allowUsers = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = ''
        Explicit SSH login allowlist. When empty, NixPI restricts SSH to the
        resolved primary operator account when one is available.
      '';
    };

    trustedInterface = lib.mkOption {
      type = lib.types.str;
      default = "wg0";
      description = ''
        Network interface trusted to reach the externally exposed NixPI
        service surface.
      '';
    };

    enforceServiceFirewall = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether NixPI service ports are opened only on the trusted interface.
      '';
    };

    passwordlessSudo.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Deprecated blanket passwordless sudo escape hatch. Keep disabled in
        favor of normal sudo prompts and the broker service.
      '';
    };
  };
}
