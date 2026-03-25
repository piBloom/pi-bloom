{ config, pkgs, lib, piAgent, appPackage, setupPackage, ... }:

let
  primaryUser = config.nixpi.primaryUser;
  primaryHome = "/home/${primaryUser}";
  canonicalRepoDir = "/srv/nixpi";
  canonicalRepoMetadataPath = "/etc/nixpi/canonical-repo.json";
  stateDir = config.nixpi.stateDir;
  systemReadyFile = "${primaryHome}/.nixpi/wizard-state/system-ready";

  bootstrapEnsureRepoTarget = pkgs.writeShellScriptBin "nixpi-bootstrap-ensure-repo-target" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    repo_dir="''${1:-}"
    primary_user="''${2:-}"
    if [ -z "$repo_dir" ] || [ -z "$primary_user" ]; then
      echo "usage: nixpi-bootstrap-ensure-repo-target <repo_dir> <primary_user>" >&2
      exit 1
    fi

    install -d -m 0755 /srv
    if [ ! -e "$repo_dir" ]; then
      install -d -o "$primary_user" -g "$primary_user" -m 0755 "$repo_dir"
    else
      chown "$primary_user:$primary_user" "$repo_dir"
      chmod 0755 "$repo_dir"
    fi
  '';

  bootstrapPrepareRepo = pkgs.writeShellScriptBin "nixpi-bootstrap-prepare-repo" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    repo_dir="''${1:-}"
    remote_url="''${2:-}"
    branch="''${3:-}"
    primary_user="''${4:-}"
    if [ -z "$repo_dir" ] || [ -z "$remote_url" ] || [ -z "$branch" ] || [ -z "$primary_user" ]; then
      echo "usage: nixpi-bootstrap-prepare-repo <repo_dir> <remote_url> <branch> <primary_user>" >&2
      exit 1
    fi

    if [ ! -d "$repo_dir/.git" ]; then
      echo "canonical repo checkout is missing .git: $repo_dir" >&2
      exit 1
    fi

    actual_remote="$(${pkgs.git}/bin/git -C "$repo_dir" remote get-url origin 2>/dev/null || true)"
    if [ "$actual_remote" != "$remote_url" ]; then
      echo "canonical repo origin mismatch: expected $remote_url, got ''${actual_remote:-<missing>}" >&2
      exit 1
    fi

    actual_branch="$(${pkgs.git}/bin/git -C "$repo_dir" branch --show-current 2>/dev/null || true)"
    if [ "$actual_branch" != "$branch" ]; then
      echo "canonical repo branch mismatch: expected $branch, got ''${actual_branch:-<detached>}" >&2
      exit 1
    fi

    install -d -m 0755 /etc/nixos
    if [ ! -f /etc/nixos/hardware-configuration.nix ]; then
      cat > /etc/nixos/hardware-configuration.nix <<EOF
{ ... }:
{
}
EOF
    fi

    cat > /etc/nixos/configuration.nix <<EOF
{ ... }:
{
  imports = [
    ./hardware-configuration.nix
    ./nixpi-host.nix
  ];
}
EOF

    cat > /etc/nixos/nixpi-branch-guard.nix <<EOF
{ ... }:
let
  currentBranch = builtins.replaceStrings [ "ref: refs/heads/" "\n" ] [ "" "" ] (builtins.readFile "$repo_dir/.git/HEAD");
in {
  assertions = [
    {
      assertion = currentBranch == "main";
      message = "Supported rebuilds require $repo_dir to be on main";
    }
  ];
}
EOF

    cat > /etc/nixos/flake.nix <<EOF
{
  description = "NixPI installed host";

  inputs.nixpkgs.url = "path:${pkgs.path}";

  outputs = { nixpkgs, ... }:
    let
      system = "${pkgs.stdenv.hostPlatform.system}";
      repoDir = /srv/nixpi;
    in {
      nixosConfigurations.nixpi = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = {
          piAgent = ${piAgent};
          appPackage = ${appPackage};
          setupPackage = ${setupPackage};
        };
        modules = [
          (repoDir + "/core/os/hosts/x86_64.nix")
          ./configuration.nix
          ./nixpi-branch-guard.nix
          {
            nixpkgs.hostPlatform = system;
            nixpkgs.config.allowUnfree = true;
          }
        ];
      };
    };
}
EOF

    rm -f /etc/nixos/flake.lock

    install -d -m 0755 /etc/nixpi
    cat > "${canonicalRepoMetadataPath}" <<EOF
{
  "path": "$repo_dir",
  "origin": "$remote_url",
  "branch": "$branch"
}
EOF
    chown root:root "${canonicalRepoMetadataPath}"
    chmod 0644 "${canonicalRepoMetadataPath}"
  '';

  bootstrapNixosRebuildSwitch = pkgs.writeShellScriptBin "nixpi-bootstrap-nixos-rebuild-switch" ''
    set -euo pipefail
    current_branch="$(${pkgs.git}/bin/git -C ${canonicalRepoDir} branch --show-current 2>/dev/null || true)"
    if [ "$current_branch" != "main" ]; then
      echo "Supported rebuilds require ${canonicalRepoDir} to be on main" >&2
      exit 1
    fi

    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    exec /run/current-system/sw/bin/nixos-rebuild switch --impure --flake "/etc/nixos#nixpi"
  '';
in
{
  imports = [ ../options.nix ];

  environment.systemPackages = [
    bootstrapEnsureRepoTarget
    bootstrapPrepareRepo
    bootstrapNixosRebuildSwitch
  ];

  security.sudo.extraRules = lib.optional config.nixpi.bootstrap.passwordlessSudo.enable {
    users = [ primaryUser ];
    commands = [
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-ensure-repo-target *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-prepare-repo *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-nixos-rebuild-switch"; options = [ "NOPASSWD" ]; }
    ];
  };
}
