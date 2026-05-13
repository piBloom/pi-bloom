{
  defaults = {
    bridge = "nazar0";
    gateway = "10.10.10.1";
    prefixLength = 24;
    interface = "ens18";
    nameservers = [
      "10.10.10.1"
      "1.1.1.1"
      "9.9.9.9"
    ];
    domain = "nazar.studio";
  };

  ranges = {
    infrastructure = {
      vmids = "101-109";
      ips = "10.10.10.21-10.10.10.29";
    };
    games = {
      vmids = "110-119";
      ips = "10.10.10.30-10.10.10.39";
    };
    personal = {
      vmids = "120-139";
      ips = "10.10.10.40-10.10.10.59";
    };
    disposable = {
      vmids = "900-999";
      purpose = "restore tests and temporary experiments only";
    };
  };

  vms = {
    git = {
      vmid = 101;
      hostname = "git";
      service = "forgejo";
      ip = "10.10.10.21";
      mac = "BC:24:11:0A:4B:0E";
      microvm = {
        tap = "vm101";
        mac = "02:00:00:00:00:21";
        shares = [
          {
            tag = "git-forgejo";
            source = "/persist/microvms/git/forgejo";
            mountPoint = "/var/lib/forgejo";
            proto = "virtiofs";
          }
        ];
      };
      dns = "git.nazar.studio";
      webPort = 3000;
      sshPort = 10022;
      cores = 2;
      memoryMiB = 2048;
      balloonMiB = 512;
      diskGiB = 32;
      onboot = true;
      startupOrder = 20;
      role = "private Git forge for the nazar infrastructure repository";
    };

    minecraft = {
      vmid = 110;
      hostname = "minecraft";
      service = "minecraft";
      ip = "10.10.10.30";
      mac = "BC:24:11:0A:4B:10";
      microvm = {
        tap = "vm110";
        mac = "02:00:00:00:00:30";
        shares = [
          {
            tag = "minecraft-state";
            source = "/persist/microvms/minecraft/state";
            mountPoint = "/var/lib/minecraft";
            proto = "virtiofs";
          }
        ];
      };
      dns = "balaur.eu";
      aliases = [ "balaur.nazar.studio" ];
      cores = 2;
      memoryMiB = 4096;
      balloonMiB = 1024;
      diskGiB = 50;
      onboot = true;
      startupOrder = 30;
      role = "small PaperMC Minecraft server";

      minecraft = {
        port = 25565;
        stateDir = "/var/lib/minecraft";
        paperVersion = "26.1.2-62";
        paperUrl = "https://fill-data.papermc.io/v1/objects/b7b9581664abfb4706823c76fb8a8285e928d690770f03813e4a82e3489a78e5/paper-26.1.2-62.jar";
        paperHash = "sha256-t7lYFmSr+0cGgjx2+4qCheko1pB3DwOBPkqC40iaeOU=";
        jvmOpts = "-Xms1G -Xmx2500M";
        maxPlayers = 10;
        motd = "Balaur Minecraft";
        levelSeed = "298649991203052898";
        operatorPermissionLevel = 4;
        operators = [
          {
            name = "Cicorrel";
            uuid = "4e885f75-ebd3-46e6-b716-8bcec8e19534";
            level = 4;
            bypassesPlayerLimit = true;
          }
        ];
        difficulty = "normal";
        gamemode = "survival";
        viewDistance = 10;
        simulationDistance = 6;
        # Add non-operator players here. Operators are whitelisted automatically
        # by the Minecraft VM module when whitelistOperators is left enabled.
        whitelist = { };
        gameRules = {
          keep_inventory = true;
        };

        # Public UDP port used by Simple Voice Chat. Requires matching host and
        # provider firewall forwarding in addition to the guest firewall.
        voiceChatPort = 24454;

        pluginConfigs."voicechat/voicechat-server.properties" = ''
          port=24454
          bind_address=
          voice_host=
          allow_pings=true
        '';

        plugins = [
          {
            name = "SimpleVoiceChat.jar";
            url = "https://hangarcdn.papermc.io/plugins/henkelmax/SimpleVoiceChat/versions/bukkit-2.6.17/PAPER/voicechat-bukkit-2.6.17.jar";
            hash = "sha256-VjJjB6o7VXdo4eRz90TiflX+7ID/HMgr6X7SyosySMc=";
          }
          {
            name = "ToolStats.jar";
            url = "https://hangarcdn.papermc.io/plugins/hyperdefined/ToolStats/versions/2.0.4/PAPER/toolstats-2.0.4.jar";
            hash = "sha256-cfH5/4Ktk6OlSpCA2fXUFW1JEC/e4LsG/OFxz9PPxSA=";
          }
          {
            name = "squaremap.jar";
            url = "https://hangarcdn.papermc.io/plugins/jmp/squaremap/versions/1.3.13/PAPER/squaremap-paper-mc26.1.2-1.3.13.jar";
            hash = "sha256-sB35IGEuEXLLutxj82A1XbryC7Uk0YpbD/dl8ViQAPw=";
          }
          {
            name = "SimpleTPA.jar";
            url = "https://hangarcdn.papermc.io/plugins/Jelly-Pudding/SimpleTPA/versions/2.0/PAPER/SimpleTPA-2.0.jar";
            hash = "sha256-wwavDV5sjR7SdrfOZzPNSB0rc5GqlVTyilcBkmKWFZU=";
          }
          {
            name = "Timberella.jar";
            url = "https://hangarcdn.papermc.io/plugins/hro_basti/timberella/versions/1.2.0/PAPER/timberella-paper-1.2.0.jar";
            hash = "sha256-hB0AtUzF9ZU/v0S1WxKb3FLFyujMoyt1Ewr73g/A0M0=";
          }
          {
            name = "Chunky.jar";
            url = "https://hangarcdn.papermc.io/plugins/pop4959/Chunky/versions/1.5.3/PAPER/Chunky-Bukkit-1.5.3.jar";
            hash = "sha256-Uw0sdDCpajmVc5G3CIvhRNqjEI92ZYltHCOqjdSvMvM=";
          }
        ];
      };
    };

    dav-server = {
      vmid = 121;
      hostname = "dav-server";
      service = "dav-server";
      ip = "10.10.10.41";
      mac = "BC:24:11:0A:4B:21";
      microvm = {
        tap = "vm121";
        mac = "02:00:00:00:00:41";
        shares = [
          {
            tag = "dav-server-data";
            source = "/persist/microvms/dav-server/data";
            mountPoint = "/var/lib/dav-server";
            proto = "virtiofs";
          }
          {
            tag = "dav-server-radicale";
            source = "/persist/microvms/dav-server/radicale";
            mountPoint = "/var/lib/radicale/collections";
            proto = "virtiofs";
          }
        ];
      };
      dns = "dav.nazar.studio";
      aliases = [ ];
      cores = 2;
      memoryMiB = 4096;
      balloonMiB = 1024;
      diskGiB = 100;
      onboot = false;
      startupOrder = 41;
      role = "private personal DAV, CalDAV, CardDAV, WebDAV, and markdown wiki data VM";

      davServer = {
        radicalePort = 5232;
        httpPort = 80;
        auth = {
          enable = true;
          realm = "Nazar DAV";
          htpasswdFile = "/var/lib/dav-server/secrets/dav-server-htpasswd";
        };
        stateDir = "/var/lib/dav-server";
        webdavRoot = "/var/lib/dav-server/webdav";
        radicaleStateDir = "/var/lib/radicale/collections";
        gitBackup = {
          enable = true;
          sourceDir = "/var/lib/dav-server/webdav/wiki";
          workTree = "/var/lib/dav-server/wiki-git-backup";
          # Use the private NAT bridge for VM-to-VM backup pushes. Public and
          # admin clients continue to use git.nazar.studio through nazar.
          repo = "ssh://git@10.10.10.21:10022/nazar/personal-wiki-backup.git";
          branch = "main";
          sshKeyFile = "/var/lib/dav-server/secrets/dav-server-wiki-backup-ed25519";
          knownHostsFile = "/var/lib/dav-server/secrets/dav-server-wiki-backup-known_hosts";
          onCalendar = "hourly";
        };
      };
    };
  };

  reserved = {
    dav-vault = {
      vmid = 122;
      hostname = "dav-vault";
      service = "dav-vault";
      ip = "10.10.10.42";
      mac = "BC:24:11:0A:4B:22";
      dns = "vault.nazar.studio";
      role = "reserved future secrets/vault VM; Bitwarden/Vaultwarden not enabled";
      enabled = false;
    };
  };
}
