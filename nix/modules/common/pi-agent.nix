{
  lib,
  pkgs,
  vm,
  ...
}:
let
  repoName =
    {
      git = "nazar";
      minecraft = "minecraft";
      dav-server = "dav-server";
    }
    .${vm.hostname} or vm.hostname;
  repoRoot = "/home/alex/${repoName}";
  repoUrl = "ssh://git@10.10.10.21:10022/nazar/${repoName}.git";
  pi = pkgs.callPackage ../../packages/pi { };
  bootstrap = pkgs.writeShellScriptBin "nazar-vm-repo-bootstrap" ''
    set -euo pipefail

    repo_name=${lib.escapeShellArg repoName}
    repo_root=${lib.escapeShellArg repoRoot}
    repo_url=${lib.escapeShellArg repoUrl}

    mkdir -p "$repo_root"
    cd "$repo_root"

    export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new"

    if [ ! -d .git ]; then
      git init -b main
    fi

    if git remote get-url origin >/dev/null 2>&1; then
      git remote set-url origin "$repo_url"
    else
      git remote add origin "$repo_url"
    fi

    git fetch origin main || true
    git checkout -B main --track origin/main || git checkout -B main

    echo "VM repo ready: $repo_root ($repo_url)"
    echo "Pi is available as: pi"
    echo "You may edit, test, commit, and push here; production deploys are handed off with: nazar-deploy-request"
    echo "Next: cd $repo_root && pi"
  '';
in
{
  environment.systemPackages = [
    pi
    pkgs.nodejs
    bootstrap
  ];

  environment.sessionVariables = {
    PI_TELEMETRY = "0";
    PI_SKIP_VERSION_CHECK = "1";
    NAZAR_VM_REPO = repoRoot;
  };

  systemd.tmpfiles.rules = [
    "d ${repoRoot} 0755 alex users - -"
  ];
}
