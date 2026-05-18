{
  lib,
  pkgs,
  vm,
  ...
}:
let
  minecraft = vm.minecraft or { };
  serverPort = minecraft.port or 25565;
  operators = minecraft.operators or [ ];
  operatorWhitelist = lib.listToAttrs (
    map (operator: {
      name = operator.name;
      value = operator.uuid;
    }) (lib.filter (operator: operator ? name && operator ? uuid) operators)
  );
  whitelist = (minecraft.whitelist or { }) // lib.optionalAttrs (minecraft.whitelistOperators or true) operatorWhitelist;
  whitelistEnabled = minecraft.enableWhitelist or (whitelist != { });
  gameRules = minecraft.gameRules or { };
  gameRuleValue = value:
    if builtins.isBool value then
      lib.boolToString value
    else
      toString value;
  gameRuleCommands = lib.mapAttrsToList (name: value: "gamerule ${name} ${gameRuleValue value}") gameRules;
  defaultPlugins = [
    {
      name = "LevelledMobs.jar";
      url = "https://hangarcdn.papermc.io/plugins/ArcanePlugins/LevelledMobs/versions/4.5.2-b146/PAPER/LevelledMobs-4.5.2%20b146.jar";
      hash = "sha256-1HtfHHmaq/iom/igKfxoh67YtK7PmUxq1ABQgqrv5AI=";
    }
    {
      name = "AuraSkills.jar";
      url = "https://hangarcdn.papermc.io/plugins/Archy/AuraSkills/versions/2.3.12/PAPER/AuraSkills-2.3.12.jar";
      hash = "sha256-uA/pAk9bZWaAPoapwsrKR7dqUp7Cm7Kc7gps/QfNFhs=";
    }
    {
      name = "InteractionVisualizer.jar";
      url = "https://hangarcdn.papermc.io/plugins/LOOHP/InteractionVisualizer/versions/2026.1.1/PAPER/InteractionVisualizer-2026.1.1.0.jar";
      hash = "sha256-i2WUoWtIZ9f9IvQ6hjhfK/s82HSe2g67jUUm8Bp3MNg=";
    }
  ];
  plugins = defaultPlugins ++ (minecraft.plugins or [ ]);
  pluginConfigs = minecraft.pluginConfigs or { };
  rcon = minecraft.rcon or { };
  rconEnabled = rcon.enable or false;
  rconPort = rcon.port or 25575;
  rconPasswordCredential = "minecraft-rcon-password";
  backupFlush = minecraft.backupFlush or { };
  backupFlushEnabled = backupFlush.enable or true;

  validPluginName = name: builtins.match "[A-Za-z0-9._+-]+\\.jar" name != null;
  validRelativePath = path: builtins.match "([^/.][^/]*)(/[^/.][^/]*)*" path != null && !(lib.hasInfix ".." path);

  javaPackage = pkgs.openjdk25_headless;

  paperPackage =
    if minecraft ? paperUrl && minecraft ? paperHash && minecraft ? paperVersion then
      pkgs.stdenvNoCC.mkDerivation {
        pname = "papermc";
        version = minecraft.paperVersion;
        src = pkgs.fetchurl {
          url = minecraft.paperUrl;
          hash = minecraft.paperHash;
        };
        nativeBuildInputs = [ pkgs.makeBinaryWrapper ];
        dontUnpack = true;
        installPhase = ''
          runHook preInstall
          install -D $src $out/share/papermc/papermc.jar
          makeWrapper ${lib.getExe javaPackage} "$out/bin/minecraft-server" \
            --append-flags "-jar $out/share/papermc/papermc.jar nogui" \
            --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ pkgs.udev ]}
          runHook postInstall
        '';
      }
    else
      pkgs.papermc;

  pluginFarm = pkgs.linkFarm "papermc-plugins" (
    map (plugin: {
      name = plugin.name;
      path = pkgs.fetchurl {
        inherit (plugin) url hash;
      };
    }) plugins
  );

  opsFile = pkgs.writeText "ops.json" (
    builtins.toJSON (
      map (operator: {
        inherit (operator) name uuid;
        level = operator.level or (minecraft.operatorPermissionLevel or 4);
        bypassesPlayerLimit = operator.bypassesPlayerLimit or false;
      }) operators
    )
  );

  applyGameRules = pkgs.writeShellScript "minecraft-apply-gamerules" ''
    set -eu

    for _ in $(seq 1 90); do
      if ${pkgs.iproute2}/bin/ss -ltn sport = :${toString serverPort} | ${pkgs.gnugrep}/bin/grep -q LISTEN; then
        sleep 5
        ${lib.concatMapStringsSep "\n        " (command: "echo ${lib.escapeShellArg command} > /run/minecraft-server.stdin") gameRuleCommands}
        exit 0
      fi
      sleep 2
    done

    echo "Timed out waiting for Minecraft server before applying declarative game rules" >&2
    exit 0
  '';
in
{
  networking.firewall.allowedUDPPorts = lib.optional (minecraft ? voiceChatPort) minecraft.voiceChatPort;

  services.minecraft-server = {
    enable = true;

    # Only keep this enabled if you agree to the Minecraft EULA:
    # https://www.minecraft.net/eula
    eula = true;

    package = paperPackage;
    dataDir = minecraft.stateDir or "/var/lib/minecraft";
    openFirewall = true;
    declarative = true;

    jvmOpts = minecraft.jvmOpts or "-Xms1G -Xmx2500M";
    whitelist = whitelist;

    serverProperties = {
      "server-port" = serverPort;
      motd = minecraft.motd or "${vm.dns} Minecraft";
      "max-players" = minecraft.maxPlayers or 10;
      "level-seed" = minecraft.levelSeed or "";
      "op-permission-level" = minecraft.operatorPermissionLevel or 4;
      difficulty = minecraft.difficulty or "normal";
      gamemode = minecraft.gamemode or "survival";
      "white-list" = whitelistEnabled;
      "enable-command-block" = false;
      "enforce-secure-profile" = true;
      "online-mode" = true;
      "view-distance" = minecraft.viewDistance or 10;
      "simulation-distance" = minecraft.simulationDistance or 6;
    } // lib.optionalAttrs rconEnabled {
      "enable-rcon" = true;
      "rcon.port" = rconPort;
      "rcon.password" = "__managed_by_systemd_credential__";
      "broadcast-rcon-to-ops" = rcon.broadcastToOps or false;
    };
  };

  # Declaratively manage PaperMC plugin jars while leaving plugin-generated
  # config/data directories mutable under /var/lib/minecraft/plugins.
  systemd.services.minecraft-server.preStart = lib.mkAfter ''
    mkdir -p plugins

    manifest=plugins/.nix-managed-plugins
    if [ -f "$manifest" ]; then
      while IFS= read -r plugin_name; do
        case "$plugin_name" in
          ""|*/*|.*) continue ;;
        esac
        if [ -L "plugins/$plugin_name" ]; then
          rm -f "plugins/$plugin_name"
        fi
      done < "$manifest"
    fi

    : > "$manifest.tmp"
    for plugin in ${pluginFarm}/*.jar; do
      [ -e "$plugin" ] || continue
      plugin_name=$(basename "$plugin")
      ln -sfn "$plugin" "plugins/$plugin_name"
      echo "$plugin_name" >> "$manifest.tmp"
    done
    mv "$manifest.tmp" "$manifest"

    ${lib.concatStringsSep "\n    " (
      lib.mapAttrsToList (path: text: ''
        install -D -m 0600 ${pkgs.writeText ("minecraft-plugin-config-" + builtins.baseNameOf path) text} "plugins/${path}"
      '') pluginConfigs
    )}

    ${lib.optionalString rconEnabled ''
      rcon_password=$(cat "$CREDENTIALS_DIRECTORY/${rconPasswordCredential}")
      if [ -z "$rcon_password" ]; then
        echo "RCON is enabled but the configured password file is empty" >&2
        exit 1
      fi
      ${pkgs.gnused}/bin/sed -i '/^rcon\.password=/d' server.properties
      # NixOS' generated server.properties may not end with a newline.
      # Force one before appending the credential-backed password.
      printf '\n%s\n' "rcon.password=$rcon_password" >> server.properties
    ''}

    cp -f ${opsFile} ops.json
    chmod +w ops.json
  '';

  systemd.services.minecraft-server.serviceConfig = lib.mkIf (rconEnabled && rcon ? passwordFile) {
    LoadCredential = [ "${rconPasswordCredential}:${rcon.passwordFile}" ];
  };

  systemd.services.minecraft-save-all-flush = lib.mkIf backupFlushEnabled {
    description = "Flush Minecraft world data before external backups";
    serviceConfig.Type = "oneshot";
    script = ''
      if ${pkgs.systemd}/bin/systemctl is-active --quiet minecraft-server.service && [ -p /run/minecraft-server.stdin ]; then
        echo "save-all flush" > /run/minecraft-server.stdin
      fi
    '';
  };

  systemd.timers.minecraft-save-all-flush = lib.mkIf backupFlushEnabled {
    description = "Flush Minecraft world data before external backups";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = backupFlush.onCalendar or "*-*-* 03:35:00";
      Persistent = true;
      Unit = "minecraft-save-all-flush.service";
    };
  };

  systemd.services.minecraft-server.postStart = lib.mkIf (gameRules != { }) ''
    ${applyGameRules} &
  '';

  assertions = [
    {
      assertion = vm.service == "minecraft";
      message = "The PaperMC module should only be imported by the minecraft VM.";
    }
    {
      assertion = serverPort > 0 && serverPort < 65536;
      message = "Minecraft port must be a valid TCP/UDP port.";
    }
    {
      assertion = rconPort > 0 && rconPort < 65536;
      message = "Minecraft RCON port must be a valid TCP port.";
    }
    {
      assertion = !rconEnabled || rcon ? passwordFile;
      message = "Minecraft RCON requires vm.minecraft.rcon.passwordFile so the password is not stored in the Nix store.";
    }
    {
      assertion = lib.all (operator: operator ? name && operator ? uuid) operators;
      message = "Every declarative Minecraft operator must define name and uuid.";
    }
    {
      assertion = lib.all (operator: !(operator ? uuid) || builtins.match "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" operator.uuid != null) operators;
      message = "Minecraft operator UUIDs must be canonical lowercase UUIDs.";
    }
    {
      assertion = lib.all (plugin: plugin ? name && plugin ? url && plugin ? hash) plugins;
      message = "Every declarative PaperMC plugin must define name, url, and hash.";
    }
    {
      assertion = lib.all (plugin: !(plugin ? name) || validPluginName plugin.name) plugins;
      message = "PaperMC plugin names must be simple .jar filenames without slashes, for example 'ViaVersion.jar'.";
    }
    {
      assertion = lib.all validRelativePath (lib.attrNames pluginConfigs);
      message = "PaperMC plugin config paths must be safe relative paths below plugins/ without dot-prefixed or '..' components.";
    }
  ];
}
