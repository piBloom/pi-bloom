{
  inputs,
  lib,
  pkgs,
  vm,
  ...
}:
let
  repoInputName =
    {
      git = "nazar";
      minecraft = "minecraft";
      dav-server = "dav-server";
    }
    .${vm.hostname} or vm.hostname;
  repoName =
    {
      git = "nazar";
      minecraft = "minecraft";
      dav-server = "dav-server";
    }
    .${vm.hostname} or vm.hostname;
  serviceModuleName =
    {
      git = "forgejo";
      minecraft = "minecraft-service";
      dav-server = "dav-server";
    }
    .${vm.hostname} or vm.hostname;
  repoRoot = "/home/alex/${repoName}";
  repoUrl = "ssh://git@10.10.10.21:10022/nazar/${repoName}.git";
  deployApp = "deploy-${vm.hostname}";
  serviceName = vm.service or vm.hostname;
  dnsName = vm.dns or "";
  dnsAliases = vm.aliases or [ ];
  dnsNames = lib.filter (name: name != "") ([ dnsName ] ++ dnsAliases);
  dnsAliasesText = if dnsAliases == [ ] then "" else lib.concatStringsSep ", " dnsAliases;
  dnsNamesText = if dnsNames == [ ] then "" else lib.concatStringsSep ", " dnsNames;
  includeCommonAgent = vm.hostname != "ownloom";
  includeQemuGuest = lib.elem vm.hostname [
    "git"
    "ownloom"
    "dav-server"
  ];
  selfFlakeRoot = "/etc/nazar/self";
  selfSwitchFlake =
    if vm.hostname == "git" then "${repoRoot}#${vm.hostname}" else "${selfFlakeRoot}#${vm.hostname}";
  fallbackUpdateCommand =
    if vm.hostname == "git" then
      "# no flake lock update needed; Forgejo is part of the Nazar flake"
    else
      "nix flake lock --update-input ${repoInputName}";
  context = {
    host = "nazar";
    orchestratorRepo = "/root/nazar";
    orchestrator = "Nazar host";
    vm = {
      hostname = vm.hostname;
      service = serviceName;
      ip = vm.ip;
      dns = dnsName;
      dnsAliases = dnsAliases;
      dnsNames = dnsNames;
    };
    serviceRepo = {
      name = repoName;
      root = repoRoot;
      url = repoUrl;
      flakeInput = repoInputName;
      nixosModule = serviceModuleName;
    };
    localDeploy = {
      authority = vm.hostname;
      flake = selfSwitchFlake;
      command = "sudo nixos-rebuild switch --flake ${selfSwitchFlake}";
      helper = "nazar-vm-switch";
    };
    productionDeploy = {
      authority = vm.hostname;
      app = deployApp;
      updateLockCommand = fallbackUpdateCommand;
      deployCommand = "nix run .#${deployApp}";
      fallbackAuthority = "nazar";
    };
    policy = {
      vmLocalRebuild = true;
      vmMayPushServiceRepo = true;
      vmHasBroadFleetDeployCredentials = false;
      nazarOwnsInfrastructureAndNetworking = true;
    };
  };
  contextJson = pkgs.writeText "nazar-vm-context.json" (builtins.toJSON context);
  contextMarkdown = pkgs.writeText "nazar-vm-context.md" ''
    # Nazar VM Context

    This machine is a NixOS VM in the Nazar fleet.

    | Item | Value |
    |---|---|
    | VM hostname | `${vm.hostname}` |
    | Service | `${serviceName}` |
    | NAT IP | `${vm.ip}` |
    | Service DNS | `${dnsName}` |
    | Service DNS aliases | `${dnsAliasesText}` |
    | All service DNS names | `${dnsNamesText}` |
    | VM-owned repo | `${repoRoot}` |
    | Forgejo remote | `${repoUrl}` |
    | Nazar flake input | `${repoInputName}` |
    | VM-local rebuild flake | `${selfSwitchFlake}` |
    | Nazar fallback deploy app | `.#${deployApp}` |

    ## Canonical workflow for agents and humans on this VM

    This VM-owned repository exports the service module for this whole NixOS VM.
    The VM is allowed to rebuild and activate itself. Nazar still owns the
    infrastructure boundary: host lifecycle, VMID/IP/MAC sizing, NAT/forwarding,
    public exposure, and shared network policy.

    Author, test, commit, push, and deploy from this VM:

    ```bash
    cd ${repoRoot}
    nix flake check --no-build
    git status
    git add <files>
    git commit
    git push
    nazar-vm-switch
    # equivalent raw command:
    sudo nixos-rebuild switch --flake ${selfSwitchFlake}
    ```

    `/etc/nazar/self` is a generated VM-local integration flake. It composes the
    current Nazar VM baseline with the local checkout at `${repoRoot}`, so agents
    can evolve this VM without asking an agent on Nazar to deploy every service edit.

    Nazar remains a fallback deploy authority and can still deploy the pushed
    service commit from the orchestrator repository:

    ```bash
    cd /root/nazar
    ${fallbackUpdateCommand}
    nix flake check --no-build
    nix run .#${deployApp}
    ```

    Do not make host lifecycle, VMID/IP/MAC, public firewall,
    or NAT forwarding changes from this VM repo. Those still belong to Nazar's
    infrastructure repository.
  '';
  agentsMarkdown = pkgs.writeText "nazar-vm-agents.md" ''
    # Nazar VM Agent Instructions

    You are running inside a Nazar NixOS VM, not on the host.

    Read `/etc/nazar/vm-context.md` or run `nazar-vm-context` for the current VM
    identity, repository, and deployment commands.

    Critical rules:

    - The VM-owned repo at `${repoRoot}` is editable from this VM.
    - The Forgejo remote `${repoUrl}` is writable when the VM repo key is
      provisioned; do not assume this checkout is read-only.
    - You may rebuild this VM locally with `nazar-vm-switch`, equivalent to
      `sudo nixos-rebuild switch --flake ${selfSwitchFlake}`.
    - Commit and push durable service changes from `${repoRoot}` so Nazar's
      fallback deploy path can reproduce them.
    - Nazar owns infrastructure and networking: host VM lifecycle, VMID/IP/MAC,
      sizing, NAT/forwarding, public exposure, and shared network policy.
    - Do not create public exposure, firewall, VMID/IP/MAC, or host
      lifecycle changes from a VM repo. Those belong to `/root/nazar`.

    Helpful commands:

    ```bash
    nazar-vm-context
    nazar-vm-switch
    nazar-deploy-request
    nazar-vm-repo-bootstrap
    ```
  '';
  contextCommand = pkgs.writeShellScriptBin "nazar-vm-context" ''
    set -eu

    format=markdown
    if [ "''${1:-}" = "--format" ]; then
      format="''${2:-markdown}"
      shift 2 || true
    elif [ "''${1:-}" = "--help" ] || [ "''${1:-}" = "-h" ]; then
      cat <<'EOF'
    Usage: nazar-vm-context [--format markdown|json]

    Print the declarative Nazar fleet context for this VM.
    EOF
      exit 0
    elif [ "''${1:-}" != "" ]; then
      echo "nazar-vm-context: unknown argument: $1" >&2
      exit 2
    fi

    case "$format" in
      markdown) cat /etc/nazar/vm-context.md ;;
      json) cat /etc/nazar/vm-context.json ;;
      *)
        echo "nazar-vm-context: --format must be markdown or json" >&2
        exit 2
        ;;
    esac
  '';
  selfSwitchCommand = pkgs.writeShellScriptBin "nazar-vm-switch" ''
    set -euo pipefail

    repo_root=${lib.escapeShellArg repoRoot}
    host=${lib.escapeShellArg vm.hostname}
    self_flake=${lib.escapeShellArg selfSwitchFlake}

    if [ ! -d "$repo_root/.git" ]; then
      echo "No git checkout found at $repo_root." >&2
      echo "Run: nazar-vm-repo-bootstrap" >&2
      exit 1
    fi

    cd "$repo_root"

    if [ -n "$(git status --porcelain)" ]; then
      echo "warning: $repo_root has uncommitted changes; nix will build the current working tree snapshot." >&2
    fi

    echo "Rebuilding $host from VM-local integration flake: $self_flake"
    if [ "$(id -u)" -eq 0 ]; then
      exec nixos-rebuild switch --flake "$self_flake" "$@"
    else
      exec sudo nixos-rebuild switch --flake "$self_flake" "$@"
    fi
  '';
  deployRequestCommand = pkgs.writeShellScriptBin "nazar-deploy-request" ''
    set -eu

    repo_root=${lib.escapeShellArg repoRoot}
    repo_input=${lib.escapeShellArg repoInputName}
    deploy_app=${lib.escapeShellArg deployApp}
    self_flake=${lib.escapeShellArg selfSwitchFlake}
    fallback_update_command=${lib.escapeShellArg fallbackUpdateCommand}

    if [ ! -d "$repo_root/.git" ]; then
      echo "No git checkout found at $repo_root." >&2
      echo "Run: nazar-vm-repo-bootstrap" >&2
      exit 1
    fi

    cd "$repo_root"

    branch=$(git branch --show-current 2>/dev/null || true)
    head=$(git rev-parse --short HEAD)
    upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
    dirty=$(git status --porcelain)

    echo "VM repo:     $repo_root"
    echo "Branch:      ''${branch:-detached}"
    echo "HEAD:        $head"
    echo "Upstream:    ''${upstream:-none}"
    echo

    if [ -n "$dirty" ]; then
      echo "Working tree has uncommitted changes:"
      git status --short
      echo
    fi

    if [ -n "$upstream" ]; then
      counts=$(git rev-list --left-right --count "$upstream...HEAD" 2>/dev/null || echo "? ?")
      behind=$(printf '%s' "$counts" | awk '{print $1}')
      ahead=$(printf '%s' "$counts" | awk '{print $2}')
      echo "Ahead/behind upstream: ahead=$ahead behind=$behind"
      if [ "$ahead" != "0" ] && [ "$ahead" != "?" ]; then
        echo "Push when ready: git push"
        echo
      fi
    else
      echo "No upstream configured. Run nazar-vm-repo-bootstrap or set an origin/main upstream."
      echo
    fi

    cat <<EOF
    VM-local deploy path:

      cd $repo_root
      nazar-vm-switch
      # or: sudo nixos-rebuild switch --flake $self_flake

    Nazar fallback deploy path after the desired commit is pushed:

      cd /root/nazar
      $fallback_update_command
      nix flake check --no-build
      nix run .#$deploy_app

    EOF
  '';
  selfFlake = pkgs.writeText "nazar-vm-self-flake.nix" ''
    {
      description = "VM-local self-rebuild flake for ${vm.hostname} in the Nazar fleet";

      inputs = {
        nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

        disko = {
          url = "github:nix-community/disko";
          inputs.nixpkgs.follows = "nixpkgs";
        };

        sops-nix = {
          url = "github:Mic92/sops-nix";
          inputs.nixpkgs.follows = "nixpkgs";
        };

        microvm = {
          url = "github:astro/microvm.nix";
          inputs.nixpkgs.follows = "nixpkgs";
        };

        nixpi = {
          url = "path:./nixpi-source";
          inputs.nixpkgs.follows = "nixpkgs";
        };

        llm-agents.url = "github:numtide/llm-agents.nix";

        ${lib.optionalString (vm.hostname != "git") ''
          "${repoInputName}" = {
            url = "path:${repoRoot}";
            inputs.nixpkgs.follows = "nixpkgs";
          };
        ''}
      };

      outputs =
        inputs@{
          self,
          nixpkgs,
          disko,
          sops-nix,
          ...
        }:
        let
          system = "x86_64-linux";
          fleet = import ./nix/fleet/vms.nix;
          vm = fleet.vms."${vm.hostname}";
          commonVmModules = [
            ./nix/modules/common/base.nix
            ./nix/modules/common/users.nix
            ./nix/modules/common/security.nix
            ./nix/modules/common/development.nix
            ./nix/modules/common/sops.nix
            ./nix/modules/common/nazar-context.nix
            ./nix/modules/common/nixpi.nix
          ];
          agentVmModules = [ ./nix/modules/common/pi-agent.nix ];
          microvmGuestModules = [
            inputs.microvm.nixosModules.microvm
            ./nix/modules/host/microvm-guest.nix
          ];
          serviceModules =
            if "${serviceModuleName}" == "forgejo" then
              [
                ./nix/modules/services/forgejo.nix
                ./nix/modules/services/forgejo-bootstrap.nix
              ]
            else if "${serviceModuleName}" == "ownloom" then
              [ ./nix/modules/services/ownloom.nix ]
            else if "${serviceModuleName}" == "dav-server" then
              [ ./nix/modules/services/dav-server.nix ]
            else
              [ inputs."${repoInputName}".nixosModules."${serviceModuleName}" ];
        in
        {
          nixosConfigurations."${vm.hostname}" = nixpkgs.lib.nixosSystem {
            inherit system;
            specialArgs = {
              inherit inputs fleet vm;
            };
            modules =
              [
                disko.nixosModules.disko
                sops-nix.nixosModules.sops
              ]
              ++ commonVmModules
              ++ microvmGuestModules
              ++ nixpkgs.lib.optionals ${if includeCommonAgent then "true" else "false"} agentVmModules
              ++ serviceModules;
          };
        };
    }
  '';
  selfFlakeSource = pkgs.runCommand "nazar-vm-self-flake-source-${vm.hostname}" { } ''
    set -eu
    mkdir -p "$out/nix/modules/common" "$out/nix/modules/services" "$out/nix/fleet" "$out/nix/users" "$out/nix/packages/pi"
    cp ${selfFlake} "$out/flake.nix"
    cp ${../../../flake.lock} "$out/flake.lock"
    cp ${../../fleet/vms.nix} "$out/nix/fleet/vms.nix"
    cp ${../../users/admin-keys.nix} "$out/nix/users/admin-keys.nix"
    cp ${./base.nix} "$out/nix/modules/common/base.nix"
    cp ${./users.nix} "$out/nix/modules/common/users.nix"
    cp ${./security.nix} "$out/nix/modules/common/security.nix"
    cp ${./networking.nix} "$out/nix/modules/common/networking.nix"
    cp ${./development.nix} "$out/nix/modules/common/development.nix"
    cp ${./sops.nix} "$out/nix/modules/common/sops.nix"
    cp ${./nazar-context.nix} "$out/nix/modules/common/nazar-context.nix"
    cp ${./nixpi.nix} "$out/nix/modules/common/nixpi.nix"
    cp ${./pi-agent.nix} "$out/nix/modules/common/pi-agent.nix"
    mkdir -p "$out/nixpi-source"
    cp -R ${inputs.nixpi}/. "$out/nixpi-source/"
    chmod -R u+w "$out/nixpi-source"
    cp ${../../packages/pi/default.nix} "$out/nix/packages/pi/default.nix"
    cp ${../../packages/pi/hashes.json} "$out/nix/packages/pi/hashes.json"
    cp ${../../packages/pi/package-lock.json} "$out/nix/packages/pi/package-lock.json"
    mkdir -p "$out/nix/modules/host"
    cp ${./qemu-guest.nix} "$out/nix/modules/common/qemu-guest.nix"
    cp ${../host/microvm-guest.nix} "$out/nix/modules/host/microvm-guest.nix"
    cp ${../services/forgejo.nix} "$out/nix/modules/services/forgejo.nix"
    cp ${../services/forgejo-bootstrap.nix} "$out/nix/modules/services/forgejo-bootstrap.nix"
    cp ${../services/ownloom.nix} "$out/nix/modules/services/ownloom.nix"
    cp ${../services/dav-server.nix} "$out/nix/modules/services/dav-server.nix"
  '';
in
{
  environment.etc."nazar/vm-context.md".source = contextMarkdown;
  environment.etc."nazar/vm-context.json".source = contextJson;

  programs.git = {
    enable = true;
    config.safe.directory = repoRoot;
  };

  environment.systemPackages = [
    contextCommand
    selfSwitchCommand
    deployRequestCommand
  ];

  environment.sessionVariables = {
    NAZAR_VM_CONTEXT = "/etc/nazar/vm-context.md";
    NAZAR_VM_REPO = repoRoot;
    NAZAR_VM_REPO_INPUT = repoInputName;
    NAZAR_VM_DEPLOY_APP = deployApp;
    NAZAR_VM_SELF_FLAKE = selfSwitchFlake;
    NAZAR_ORCHESTRATOR_REPO = "/root/nazar";
  };

  system.activationScripts.nazar-vm-agent-context = lib.stringAfter [ "users" ] ''
    install -d -m 0755 -o alex -g users /home/alex/.pi/agent
    install -m 0644 -o alex -g users ${lib.escapeShellArg agentsMarkdown} /home/alex/.pi/agent/AGENTS.md
  '';

  system.activationScripts.nazar-vm-self-flake = lib.stringAfter [ "etc" "users" ] ''
    install -d -m 0755 -o root -g root ${selfFlakeRoot}
    ${pkgs.rsync}/bin/rsync -a --delete ${selfFlakeSource}/ ${selfFlakeRoot}/
    chmod -R u=rwX,go=rX ${selfFlakeRoot}
  '';
}
