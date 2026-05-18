{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.nazar.lifeOs.client;
  mountPoint = toString cfg.mountPoint;
  calendarSyncDir = toString cfg.caldav.calendarSyncDir;
  contactsSyncDir = toString cfg.caldav.contactsSyncDir;
  vdirsyncerStatusDir = toString cfg.caldav.vdirsyncerStatusDir;
  remoteAuthAttrs = lib.optionalAttrs (cfg.caldav.username != null) {
    username = cfg.caldav.username;
  };
in
{
  options.nazar.lifeOs.client = {
    enable = lib.mkEnableOption "Life OS client integration";

    user = lib.mkOption {
      type = lib.types.str;
      default = "alex";
      description = "User that owns and consumes the Life OS client data.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "users";
      description = "Group that owns and consumes the Life OS client data.";
    };

    davUrl = lib.mkOption {
      type = lib.types.str;
      description = "Life OS WebDAV URL reachable through Tailscale.";
    };

    mountPoint = lib.mkOption {
      type = lib.types.path;
      default = "/home/${cfg.user}/LifeOS";
      defaultText = lib.literalExpression ''"/home/$${config.nazar.lifeOs.client.user}/LifeOS"'';
      description = "Local mount point for the Life OS WebDAV filesystem.";
    };

    caldav = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Enable declarative CalDAV/CardDAV sync and CLI consumers.";
      };

      url = lib.mkOption {
        type = lib.types.str;
        description = "Radicale CalDAV/CardDAV base URL reachable through Tailscale.";
      };

      username = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Optional Radicale username. Keep null while Nazar's Radicale is protected by Tailscale-only access without app credentials.";
      };

      calendarSyncDir = lib.mkOption {
        type = lib.types.path;
        default = "/home/${cfg.user}/.local/share/life-os/calendars";
        description = "Local vdirsyncer filesystem storage for calendars and VTODO reminders.";
      };

      contactsSyncDir = lib.mkOption {
        type = lib.types.path;
        default = "/home/${cfg.user}/.local/share/life-os/contacts";
        description = "Local vdirsyncer filesystem storage for CardDAV contacts.";
      };

      vdirsyncerStatusDir = lib.mkOption {
        type = lib.types.path;
        default = "/home/${cfg.user}/.local/state/vdirsyncer/life-os";
        description = "Local vdirsyncer status directory for Life OS sync state.";
      };
    };

    desktopApps.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Install desktop applications useful for consuming Life OS.";
    };

    kdeApps.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Install KDE PIM applications for CalDAV/CardDAV calendars, contacts, tasks, and reminders.";
    };

    thunderbird.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Install Thunderbird as a reliable CalDAV/CardDAV client and debugging fallback.";
    };

    obsidian.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Install Obsidian for Life OS Markdown notes and journals.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = config.services.tailscale.enable;
        message = "Life OS client requires services.tailscale.enable = true.";
      }
      {
        assertion = config.services.tailscale.useRoutingFeatures == "client";
        message = "Life OS client expects Tailscale client mode unless routing behavior is explicitly designed.";
      }
    ];

    services.davfs2.enable = true;

    systemd.tmpfiles.rules = [
      "d ${mountPoint} 0750 ${cfg.user} ${cfg.group} - -"
    ]
    ++ lib.optionals cfg.caldav.enable [
      "d /home/${cfg.user}/.config 0700 ${cfg.user} ${cfg.group} - -"
      "d /home/${cfg.user}/.config/khal 0700 ${cfg.user} ${cfg.group} - -"
      "d /home/${cfg.user}/.config/khard 0700 ${cfg.user} ${cfg.group} - -"
      "d /home/${cfg.user}/.config/todoman 0700 ${cfg.user} ${cfg.group} - -"
      "d /home/${cfg.user}/.local/share/life-os 0700 ${cfg.user} ${cfg.group} - -"
      "d ${calendarSyncDir} 0700 ${cfg.user} ${cfg.group} - -"
      "d ${contactsSyncDir} 0700 ${cfg.user} ${cfg.group} - -"
      "d ${vdirsyncerStatusDir} 0700 ${cfg.user} ${cfg.group} - -"
      "L+ /home/${cfg.user}/.config/khal/config - - - - /etc/xdg/khal/config"
      "L+ /home/${cfg.user}/.config/khard/khard.conf - - - - /etc/xdg/khard/khard.conf"
      "L+ /home/${cfg.user}/.config/todoman/config.py - - - - /etc/xdg/todoman/config.py"
    ];

    fileSystems.${mountPoint} = {
      device = cfg.davUrl;
      fsType = "davfs";
      options = [
        "noauto"
        "nofail"
        "x-systemd.automount"
        "x-systemd.idle-timeout=10min"
        "x-systemd.after=tailscaled.service"
        "_netdev"
        "uid=${cfg.user}"
        "gid=${cfg.group}"
        "file_mode=0640"
        "dir_mode=0750"
      ];
    };

    services.vdirsyncer = lib.mkIf cfg.caldav.enable {
      enable = true;
      jobs.life-os = {
        user = cfg.user;
        group = cfg.group;
        forceDiscover = true;
        timerConfig = {
          OnBootSec = "5min";
          OnUnitActiveSec = "15min";
          RandomizedDelaySec = "2min";
        };
        config = {
          statusPath = vdirsyncerStatusDir;
          pairs = {
            life_os_calendars = {
              a = "life_os_remote_calendars";
              b = "life_os_local_calendars";
              collections = [ "from a" ];
              conflict_resolution = "b wins";
              metadata = [
                "color"
                "displayname"
              ];
            };
            life_os_contacts = {
              a = "life_os_remote_contacts";
              b = "life_os_local_contacts";
              collections = [ "from a" ];
              conflict_resolution = "b wins";
              metadata = [ "displayname" ];
            };
          };
          storages = {
            life_os_remote_calendars = {
              type = "caldav";
              url = cfg.caldav.url;
            }
            // remoteAuthAttrs;
            life_os_local_calendars = {
              type = "filesystem";
              path = calendarSyncDir;
              fileext = ".ics";
            };
            life_os_remote_contacts = {
              type = "carddav";
              url = cfg.caldav.url;
            }
            // remoteAuthAttrs;
            life_os_local_contacts = {
              type = "filesystem";
              path = contactsSyncDir;
              fileext = ".vcf";
            };
          };
        };
      };
    };

    systemd.services."vdirsyncer@life-os" = lib.mkIf cfg.caldav.enable {
      after = [ "tailscaled.service" ];
      wants = [ "tailscaled.service" ];
    };

    environment.etc = lib.mkIf cfg.caldav.enable {
      "xdg/khal/config".text = ''
        [calendars]
        [[life-os]]
        path = ${calendarSyncDir}/*
        type = discover

        [locale]
        local_timezone = ${config.time.timeZone}
        default_timezone = ${config.time.timeZone}
        timeformat = %H:%M
        dateformat = %Y-%m-%d
        longdateformat = %Y-%m-%d
        datetimeformat = %Y-%m-%d %H:%M
        longdatetimeformat = %Y-%m-%d %H:%M
      '';

      "xdg/khard/khard.conf".text = ''
        [addressbooks]
        [[life-os]]
        path = ${contactsSyncDir}/*

        [general]
        default_action = list
        editor = vim
      '';

      "xdg/todoman/config.py".text = ''
        path = "${calendarSyncDir}/*"
        default_list = "life-os"
        date_format = "%Y-%m-%d"
        time_format = "%H:%M"
      '';
    };

    environment.systemPackages =
      lib.optionals (cfg.desktopApps.enable && cfg.obsidian.enable) [
        pkgs.obsidian
      ]
      ++ lib.optionals cfg.caldav.enable [
        pkgs.vdirsyncer
        pkgs.khal
        pkgs.khard
        pkgs.todoman
      ]
      ++ lib.optionals (cfg.desktopApps.enable && cfg.thunderbird.enable) [
        pkgs.thunderbird
      ]
      ++ lib.optionals (cfg.desktopApps.enable && cfg.kdeApps.enable) (
        [
          pkgs.kdePackages.korganizer
          pkgs.kdePackages.kaddressbook
          pkgs.kdePackages.kontact
        ]
        ++ lib.optional (pkgs.kdePackages ? merkuro) pkgs.kdePackages.merkuro
      );
  };
}
