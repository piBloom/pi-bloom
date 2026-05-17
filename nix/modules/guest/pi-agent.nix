{
  lib,
  pkgs,
  vm,
  ...
}:
let
  repoName = vm.repoName or vm.hostname;
  repoRoot = "/home/alex/${repoName}";
  bootstrap = pkgs.writeShellScriptBin "nazar-vm-repo-bootstrap" ''
    set -euo pipefail

    repo_name=${lib.escapeShellArg repoName}
    repo_root=${lib.escapeShellArg repoRoot}

    if [ ! -d "$repo_root" ]; then
      echo "Repo directory $repo_root does not exist." >&2
      echo "This should be a virtiofs mount from the host." >&2
      exit 1
    fi

    cd "$repo_root"

    if [ ! -d .git ]; then
      echo "Repo not initialized at $repo_root." >&2
      echo "The host should provision this directory via:" >&2
      echo "  nazar-git-init $repo_name" >&2
      exit 1
    fi

    echo "VM repo ready: $repo_root"
    echo "Pi is available as: pi"
    echo "You may edit, test, and commit here. To deploy, push and request a rebuild from the Nazar host."
    echo "Next: cd $repo_root && pi"
  '';
  agentsMarkdown = pkgs.writeText "nazar-vm-agents.md" ''
    # Nazar VM Agent Instructions

    You are running inside a Nazar NixOS VM, not on the host.

    VM identity:

    - Hostname: `${vm.hostname}`
    - Service repo: `${repoRoot}` (virtiofs mount from host, no SSH needed)
    - NAT IP: `${vm.ip}`

    Critical rules:

    - The VM-owned repo at `${repoRoot}` is editable from this VM.
    - Commit and push durable service changes from `${repoRoot}`.
    - To deploy changes, push to the remote and request a rebuild from the Nazar host:
      `nix run github:nazar/nazar#switch-${vm.hostname}` (run on the host).
    - Nazar owns infrastructure and networking: host VM lifecycle, VMID/IP/MAC,
      sizing, NAT/forwarding, public exposure, and shared network policy.
    - Do not create public exposure, firewall, VMID/IP/MAC, or host
      lifecycle changes from a VM repo. Those belong to `/root/nazar`.
  '';
  pi = pkgs.callPackage ../../packages/pi { };
  sharedAuthMountPoint = "/var/lib/nazar/pi-agent-auth";

  # Per-VM LSP servers. Override in fleet config with
  #   vm.piAgent.lspServers = [ pkgs.gopls ];
  # or add to the defaults below.
  defaultLspServers = [
    pkgs.nixd                       # Nix
    pkgs.typescript-language-server  # TypeScript/JavaScript
    pkgs.pyright                    # Python
  ];

  # Per-VM language runtimes + extra LSP servers.
  # Keyed by hostname so each VM gets what its project needs.
  vmExtraPackages =
    {
      minecraft = [
        pkgs.jdk21                     # Java runtime
        pkgs.jdt-language-server        # Java LSP
      ];
    }
    .${vm.hostname} or [];
in
{
  imports = [ ./pi-default-packages.nix ];

  # Allow Git operations in the VM service repo without ownership warnings.
  programs.git = {
    enable = true;
    config.safe.directory = repoRoot;
  };

  environment.systemPackages = [
    pi
    pkgs.nodejs
    bootstrap
  ] ++ defaultLspServers ++ vmExtraPackages;

  environment.sessionVariables = {
    PI_TELEMETRY = "0";
    PI_SKIP_VERSION_CHECK = "1";
    NAZAR_VM_REPO = repoRoot;
  };

  systemd.tmpfiles.rules = [
    "d ${repoRoot} 0755 alex users - -"
  ];

  system.activationScripts.nazar-vm-agent-context = lib.stringAfter [ "users" ] ''
    install -d -m 0755 -o alex -g users /home/alex/.pi/agent
    install -m 0644 -o alex -g users ${lib.escapeShellArg agentsMarkdown} /home/alex/.pi/agent/AGENTS.md
  '';

  # VM agents share only provider auth/model configuration with Nazar. Session
  # history, extension installs, caches, and project settings remain VM-local.
  # If a VM already has local auth files, seed the shared copy when it is empty;
  # otherwise keep a one-time backup before linking to the shared directory.
  system.activationScripts.nazar-vm-pi-shared-auth = lib.stringAfter [ "users" "nazar-pi-default-packages" ] ''
    set -euo pipefail

    agent_dir=/home/alex/.pi/agent
    shared_dir=${lib.escapeShellArg sharedAuthMountPoint}

    if [ ! -d "$shared_dir" ]; then
      echo "Pi shared auth directory $shared_dir is not mounted; leaving local VM auth untouched." >&2
      exit 0
    fi

    install -d -m 0755 -o alex -g users "$agent_dir"

    link_shared_file() {
      local name="$1"
      local mode="$2"
      local local_file="$agent_dir/$name"
      local shared_file="$shared_dir/$name"
      local backup_file="$agent_dir/$name.${vm.hostname}-local-backup"

      if [ -e "$local_file" ] && [ ! -L "$local_file" ]; then
        if [ ! -e "$shared_file" ]; then
          install -m "$mode" -o alex -g users "$local_file" "$shared_file"
        elif [ ! -e "$backup_file" ]; then
          install -m "$mode" -o alex -g users "$local_file" "$backup_file"
        fi
        rm -f "$local_file"
      fi

      ln -sfn "$shared_file" "$local_file"

      if [ -e "$shared_file" ]; then
        chown alex:users "$shared_file"
        chmod "$mode" "$shared_file"
      fi
    }

    link_shared_file auth.json 0600
    link_shared_file models.json 0600
  '';
}
