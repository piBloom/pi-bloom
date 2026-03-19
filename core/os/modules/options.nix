# core/os/modules/options.nix
# Shared NixOS options consumed by nixpi shell/firstboot modules.
{ lib, ... }:

{
  options.nixpi.username = lib.mkOption {
    type        = lib.types.str;
    default     = "pi";
    description = ''
      Primary system user for the nixPI machine. All nixPI modules
      derive the user name, home directory, and service ownership from it.
    '';
  };
}
