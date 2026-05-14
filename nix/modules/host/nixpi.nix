{
  fleet,
  inputs,
  pkgs,
  ...
}:
let
  pi = pkgs.callPackage ../../packages/pi { };

  # Build workspace definitions from the fleet config.
  # Local workspaces (host) + SSH workspaces (one per VM with nixpi enabled).
  mkWorkspace = name: vm: {
    cwd = vm.nixpi.workingDirectory or "/home/alex/${name}";
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

  vmWorkspaces = builtins.mapAttrs mkWorkspace fleet.vms;
in
{
  imports = [
    inputs.nixpi.nixosModules.nixpi
    ../common/pi-default-packages.nix
  ];

  services.nixpi = {
    enable = true;
    user = "alex";
    group = "users";
    home = "/home/alex";
    workingDirectory = "/home/alex";
    host = "127.0.0.1";
    port = 4815;
    piBinary = "${pi}/bin/pi";
    idleTimeoutMs = 300000; # 5 min

    defaultWorkspace = "nazar";
    workspaces = {
      nazar = hostWorkspace;
    } // vmWorkspaces;
    # Run directly from local git checkout so server.js changes are picked up
    # immediately without needing to rebuild the nixpi package.
    sourceDir = /home/alex/repos/nixpi;
  };

  # NixPi spawns `node` for its RPC/web worker path; keep that executable in
  # the unit PATH in addition to the wrapped entrypoint's absolute Node path.
  # SSH is needed for remote VM workspaces (spawns `ssh user@host pi --mode rpc`).
  systemd.services.nixpi = {
    path = [ pkgs.nodejs_22 pkgs.openssh ];
    environment.NPM_CONFIG_PREFIX = "/home/alex/.pi/npm-global";
  };
}
