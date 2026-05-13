{ pkgs, ... }:
let
  pi = pkgs.callPackage ../../packages/pi { };
in
{
  imports = [ ../common/pi-default-packages.nix ];

  environment.systemPackages = [
    pi
    pkgs.nodejs

    # LSP servers for pi-lens (avoids broken auto-installer)
    pkgs.nixd                       # Nix
    pkgs.typescript-language-server  # TypeScript/JavaScript
    pkgs.python3.pkgs.pyright       # Python
  ];

  environment.sessionVariables = {
    PI_TELEMETRY = "0";
    PI_SKIP_VERSION_CHECK = "1";
  };
}
