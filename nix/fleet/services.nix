{
  defaults = {
    domain = "nazar.studio";
  };

  services = {
    minecraft = {
      hostname = "nazar";
      service = "minecraft";
      dns = "mc.nazar.studio";
      aliases = [ ];
      role = "small PaperMC Minecraft server";

      minecraft = {
        port = 25565;
        stateDir = "/persist/services/minecraft";
        paperVersion = "26.1.2-62";
        paperUrl = "https://fill-data.papermc.io/v1/objects/b7b9581664abfb4706823c76fb8a8285e928d690770f03813e4a82e3489a78e5/paper-26.1.2-62.jar";
        paperHash = "sha256-t7lYFmSr+0cGgjx2+4qCheko1pB3DwOBPkqC40iaeOU=";
        jvmOpts = "-Xms1G -Xmx2500M";
        maxPlayers = 10;
        motd = "Nazar Minecraft";
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
        enableWhitelist = false;
        whitelist = { };
        gameRules = {
          keep_inventory = true;
        };

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
  };
}
