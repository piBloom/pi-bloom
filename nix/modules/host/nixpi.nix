{ fleet, lib, pkgs, ... }:
let
  pi = pkgs.callPackage ../../packages/pi { };
  sourceDir = "/home/alex/repos/nixpi";

  # Build workspace definitions from the fleet config.
  # Nazar runs the only NixPI web service; VM workspaces SSH into lightweight
  # Pi agents and start `pi --mode rpc` in the VM-owned checkout.
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
  workspacesJson = pkgs.writeText "nixpi-bun-workspaces.json" (builtins.toJSON {
    default = "nazar";
    workspaces = {
      nazar = hostWorkspace;
    } // vmWorkspaces;
  });
in
{
  imports = [ ../guest/pi-default-packages.nix ];

  systemd.tmpfiles.rules = [
    "d /home/alex/.pi 0750 alex users - -"
    "d /home/alex/.pi/agent 0750 alex users - -"
  ];

  # Run the Bun implementation as the canonical NixPi service. The old Node.js
  # flake module is intentionally not imported; /home/alex/repos/nixpi is the
  # Bun checkout used by the service.
  systemd.services.nixpi = {
    description = "Bun-based NixPi web interface for Pi Coding Agent";
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];

    environment = {
      HOME = "/home/alex";
      USER = "alex";
      LOGNAME = "alex";
      NIXPI_HOST = "127.0.0.1";
      NIXPI_PORT = "4815";
      NIXPI_CWD = "/home/alex";
      NIXPI_PI_BIN = "${pi}/bin/pi";
      NIXPI_SSH_BIN = "${pkgs.openssh}/bin/ssh";
      NIXPI_IDLE_TIMEOUT_MS = "300000";
      NIXPI_WORKSPACES_CONFIG = "${workspacesJson}";
      NPM_CONFIG_PREFIX = "/home/alex/.pi/npm-global";
      PI_SKIP_VERSION_CHECK = "1";
      PI_TELEMETRY = "0";
    };

    serviceConfig = {
      Type = "simple";
      User = "alex";
      Group = "users";
      WorkingDirectory = sourceDir;
      ExecStart = "${pkgs.bun}/bin/bun ${sourceDir}/server.js";
      Restart = "on-failure";
      RestartSec = 3;
      UMask = "0027";
    };

    # Node/npm remains available for Pi's extension installer; SSH is needed for
    # remote VM workspaces.
    path = [
      pkgs.nodejs_22
      pkgs.openssh
    ];
  };
}
