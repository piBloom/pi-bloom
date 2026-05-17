{
  fleet,
  inputs,
  lib,
  pkgs,
  ...
}:
let
  pi = pkgs.callPackage ../../packages/pi { };

  # Build workspace definitions from the fleet config. Nazar runs the only
  # NixPi web service; VM workspaces SSH into lightweight Pi agents and start
  # `pi --mode rpc` in the VM-owned checkout.
  piAgentVms = lib.filterAttrs (_name: vm: vm.piAgent.enable or false) fleet.vms;
  mkWorkspace = name: vm: {
    cwd = vm.piAgent.workingDirectory or "/home/alex/${vm.repoName or name}";
    mode = "ssh";
    sshHost = vm.ip;
    sshUser = "alex";
    context = vm.role or "";
  };

  hostWorkspace = {
    cwd = "/home/alex";
    mode = "local";
    context = "Nazar host (infrastructure)";
  };

  vmWorkspaces = builtins.mapAttrs mkWorkspace piAgentVms;
in
{
  imports = [
    inputs.nixpi.nixosModules.nixpi-bun
    ../guest/pi-default-packages.nix
  ];

  # Production NixPi is the reproducible flake-provided package/module. Remote
  # VM workspaces receive Pi auth/model files through NixPi's runtime SSH sync;
  # no shared host/VM auth mount is part of the production path.
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
    } // vmWorkspaces;
    environment = {
      # Pi's package manager installs user-scoped extension packages with npm.
      NPM_CONFIG_PREFIX = "/home/alex/.pi/npm-global";
    };
  };
}
