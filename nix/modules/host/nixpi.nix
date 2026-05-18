{ pkgs, ... }:
let
  pi = pkgs.callPackage ../../packages/pi { };

  hostWorkspace = {
    cwd = "/home/alex";
    mode = "local";
    context = "Nazar host infrastructure";
  };

  serviceWorkspaces = {
    minecraft = {
      cwd = "/home/alex/nazar/services/minecraft";
      mode = "local";
      context = "Minecraft host service";
    };
    dav-server = {
      cwd = "/home/alex/nazar/services/dav-server";
      mode = "local";
      context = "DAV host service";
    };
  };
in
{
  imports = [
    ../../../services/nixpi/nix/modules/nixpi-bun.nix
    ../guest/pi-default-packages.nix
  ];

  services.nixpi-bun = {
    enable = true;
    user = "alex";
    group = "users";
    home = "/home/alex";
    host = "127.0.0.1";
    port = 4815;
    workingDirectory = "/home/alex";
    piBinary = "${pi}/bin/pi";
    idleTimeoutMs = 300000;
    defaultWorkspace = "nazar";
    workspaces = {
      nazar = hostWorkspace;
    }
    // serviceWorkspaces;
    environment = {
      NPM_CONFIG_PREFIX = "/home/alex/.pi/npm-global";
    };
  };
}
