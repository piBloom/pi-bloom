{
  lib,
  pkgs,
  vm,
  ...
}:
let
  cfg = vm.davServer;
  stateDir = cfg.stateDir;
  webdavRoot = cfg.webdavRoot;
  radicaleStateDir = cfg.radicaleStateDir;
  radicalePort = cfg.radicalePort;
  httpPort = cfg.httpPort;
  auth = cfg.auth or { };
  authEnable = auth.enable or false;
  authRealm = auth.realm or "Nazar DAV";
  htpasswdFile = auth.htpasswdFile or "${stateDir}/secrets/dav-server-htpasswd";
  gitBackup = cfg.gitBackup or { };
  gitBackupEnable = gitBackup.enable or false;
  gitBackupSourceDir = gitBackup.sourceDir or "${webdavRoot}/wiki";
  gitBackupWorkTree = gitBackup.workTree or "${stateDir}/wiki-git-backup";
  gitBackupRepo = gitBackup.repo or "ssh://git@10.10.10.21:10022/nazar/personal-wiki-backup.git";
  gitBackupBranch = gitBackup.branch or "main";
  gitBackupSshKey = gitBackup.sshKeyFile or "${stateDir}/secrets/dav-server-wiki-backup-ed25519";
  gitBackupKnownHosts =
    gitBackup.knownHostsFile or "${stateDir}/secrets/dav-server-wiki-backup-known_hosts";
  gitBackupCalendar = gitBackup.onCalendar or "hourly";
  authBasicConfig = lib.optionalString authEnable ''
    auth_basic "${authRealm}";
    auth_basic_user_file ${htpasswdFile};
  '';
in
{
  fileSystems."/" = {
    device = lib.mkDefault "tmpfs";
    fsType = lib.mkDefault "tmpfs";
    options = lib.mkDefault [
      "size=2G"
      "mode=755"
    ];
  };

  environment.systemPackages = with pkgs; [
    curl
    git
    jq
    openssh
    rsync
  ];

  services.radicale = {
    enable = true;
    settings = {
      server.hosts = [ "127.0.0.1:${toString radicalePort}" ];
      auth.type = if authEnable then "http_x_remote_user" else "none";
      rights.type = "owner_only";
      storage.filesystem_folder = radicaleStateDir;
      web.type = "internal";
    };
  };

  services.nginx = {
    enable = true;
    package = pkgs.nginxStable.override { modules = [ pkgs.nginxModules.dav ]; };
    recommendedOptimisation = true;
    recommendedProxySettings = true;

    virtualHosts.${vm.dns} = {
      default = true;
      listen = [
        {
          addr = "0.0.0.0";
          port = httpPort;
        }
      ];

      locations."/".return = "200 'Nazar DAV VM: private endpoints are /radicale/ and /files/.\n'";

      locations."/radicale/" = {
        proxyPass = "http://127.0.0.1:${toString radicalePort}/";
        extraConfig = ''
          ${authBasicConfig}
          proxy_set_header X-Script-Name /radicale;
          proxy_set_header X-Remote-User $remote_user;
          client_max_body_size 128m;
        '';
      };

      locations."/files/" = {
        alias = "${webdavRoot}/";
        extraConfig = ''
          ${authBasicConfig}
          dav_methods PUT DELETE MKCOL COPY MOVE;
          dav_ext_methods PROPFIND OPTIONS LOCK UNLOCK;
          create_full_put_path on;
          dav_access user:rw group:rw all:rw;
          autoindex on;
          client_max_body_size 512m;
          client_body_temp_path ${stateDir}/nginx-client-body;
        '';
      };
    };
  };

  systemd.tmpfiles.rules = [
    "d ${stateDir} 0750 nginx nginx - -"
    "d ${stateDir}/secrets 0750 root nginx - -"
    "d ${stateDir}/nginx-client-body 0750 nginx nginx - -"
    "d ${webdavRoot} 0750 nginx nginx - -"
    "d ${webdavRoot}/wiki 0750 nginx nginx - -"
    "d ${radicaleStateDir} 0750 radicale radicale - -"
  ];

  systemd.services.dav-server-wiki-git-backup = lib.mkIf gitBackupEnable {
    description = "Snapshot Nazar DAV wiki to git";
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    path = with pkgs; [
      coreutils
      findutils
      git
      openssh
      rsync
    ];
    serviceConfig = {
      Type = "oneshot";
      User = "root";
      Group = "root";
      UMask = "0077";
    };
    script = ''
      set -euo pipefail

      if [ ! -r ${gitBackupSshKey} ]; then
        echo "Missing git backup SSH key: ${gitBackupSshKey}" >&2
        exit 1
      fi

      install -d -o root -g root -m 0700 ${gitBackupWorkTree}
      chown root:root ${gitBackupWorkTree}
      install -d -o nginx -g nginx -m 0750 ${gitBackupSourceDir}

      cd ${gitBackupWorkTree}
      if [ ! -d .git ]; then
        git init -b ${gitBackupBranch}
        git remote add origin ${gitBackupRepo}
      fi

      git config user.name "Nazar DAV Wiki Backup"
      git config user.email "dav-server@nazar.studio"

      rsync -a --delete --no-owner --no-group --exclude='.git/' ${gitBackupSourceDir}/ ${gitBackupWorkTree}/
      chown -R root:root ${gitBackupWorkTree}

      if ! find ${gitBackupWorkTree} -mindepth 1 -maxdepth 1 ! -name .git | grep -q .; then
        printf 'Nazar DAV wiki backup placeholder. Remove once the WebDAV wiki contains files.\n' > .backup-placeholder
      else
        rm -f .backup-placeholder
      fi

      git add -A
      if git diff --cached --quiet; then
        echo "No DAV wiki changes to snapshot."
      else
        git commit -m "DAV wiki snapshot $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      fi

      GIT_SSH_COMMAND="ssh -i ${gitBackupSshKey} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${gitBackupKnownHosts}" \
        git push origin HEAD:${gitBackupBranch}
    '';
  };

  systemd.timers.dav-server-wiki-git-backup = lib.mkIf gitBackupEnable {
    description = "Periodically snapshot Nazar DAV wiki to git";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = gitBackupCalendar;
      Persistent = true;
      Unit = "dav-server-wiki-git-backup.service";
    };
  };

  systemd.services.dav-server-auth-gate = {
    description = "Document Nazar DAV bootstrap auth gate";
    wantedBy = [ "multi-user.target" ];
    after = [
      "nginx.service"
      "radicale.service"
    ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      cat <<'EOF'
      Nazar DAV VM mode: Radicale and WebDAV are reachable through the private Nazar network.
      Authentication enabled: ${if authEnable then "yes" else "no"}.
      If authentication is enabled, keep ${htpasswdFile} provisioned outside git with root:nginx 0640 permissions.
      EOF
    '';
  };

  networking.firewall.allowedTCPPorts = [ httpPort ];

  assertions = [
    {
      assertion = vm.service == "dav-server";
      message = "The DAV server module should only be imported by the dav-server VM.";
    }
    {
      assertion = httpPort == 80;
      message = "DAV server currently expects HTTP port 80 behind private WireGuard/Nazar routing.";
    }
  ];

  system.stateVersion = "26.05";
}
