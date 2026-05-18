{
  inputs,
  lib,
  pkgs,
  ...
}:
let
  hermesWhatsappBridge = pkgs.buildNpmPackage {
    pname = "hermes-whatsapp-bridge";
    version = "1.0.0";
    src = "${inputs.hermes-agent}/scripts/whatsapp-bridge";
    npmDepsHash = "sha256-KzZ7O39q/PIUPvLmjOQY1ijbO9is/XWCWOzwd1PAcQ4=";
    forceGitDeps = true;
    makeCacheWritable = true;
    dontNpmBuild = true;
    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -R . $out/
      runHook postInstall
    '';
  };

  whatsappEnvironment = {
    WHATSAPP_ENABLED = "true";
    WHATSAPP_MODE = "bot";
    WHATSAPP_HOME_CHANNEL = "40724417990@s.whatsapp.net";
    WHATSAPP_HOME_CHANNEL_NAME = "Alex WhatsApp";
    WHATSAPP_ALLOWED_USERS = "+40724417990,40724417990,40724417990@s.whatsapp.net";
    WHATSAPP_DM_POLICY = "allowlist";
    WHATSAPP_GROUP_POLICY = "disabled";
  };
in
{
  # The upstream Hermes NixOS module owns the state directory, generated
  # config, and gateway service. Run it as alex because Nazar is a private,
  # single-user operator host and we want OAuth/files/repo edits to behave like
  # normal alex shell sessions.
  services.hermes-agent = {
    enable = true;
    user = "alex";
    group = "users";
    createUser = false;
    addToSystemPackages = true;

    # Optional host-local env file for non-OAuth secrets such as API server
    # keys. OpenAI Codex/ChatGPT OAuth persists in $HERMES_HOME/auth.json.
    environmentFiles = [ "/var/lib/hermes/env" ];

    settings = {
      model = {
        provider = "openai-codex";
        default = "gpt-5.5";
      };
      toolsets = [ "all" ];
      terminal = {
        backend = "local";
        timeout = 180;
      };
      memory = {
        memory_enabled = true;
        user_profile_enabled = true;
      };

      platforms.whatsapp = {
        enabled = true;
        home_channel = {
          platform = "whatsapp";
          chat_id = "40724417990@s.whatsapp.net";
          name = "Alex WhatsApp";
        };
        extra = {
          bridge_script = "${hermesWhatsappBridge}/bridge.js";
          bridge_port = 3000;
          session_path = "/var/lib/hermes/.hermes/whatsapp/session";
        };
      };

      whatsapp = {
        dm_policy = "allowlist";
        allow_from = [
          "+40724417990"
          "40724417990"
          "40724417990@s.whatsapp.net"
        ];
        group_policy = "disabled";
      };
    };

    environment = whatsappEnvironment;

    extraPackages = with pkgs; [
      bashInteractive
      coreutils
      curl
      fd
      git
      jq
      nix
      nixfmt
      nodejs_22
      (pkgs.writeShellApplication {
        name = "hermes-whatsapp-pair";
        runtimeInputs = [ pkgs.nodejs_22 ];
        text = ''
          install -d -m 0700 /var/lib/hermes/.hermes/whatsapp/session
          exec node ${hermesWhatsappBridge}/bridge.js \
            --pair-only \
            --session /var/lib/hermes/.hermes/whatsapp/session
        '';
      })
      openssh
      python3
      ripgrep
    ];
  };

  # The upstream module only chowns top-level state directories. Convert any
  # existing state files from the previous hermes-user deployment so gateway
  # locks, OAuth tokens, sessions, memories, and logs are readable by alex.
  system.activationScripts.nazar-hermes-alex-state = lib.stringAfter [ "hermes-agent-setup" ] ''
    chown -R alex:users /var/lib/hermes
  '';

  # Keep the module's default workspace under /var/lib/hermes so activation does
  # not change /home/alex permissions, but allow the private gateway to work on
  # alex-owned repos when explicitly asked.
  systemd.services.hermes-agent.serviceConfig.ReadWritePaths = [ "/home/alex" ];
  systemd.services.hermes-agent.environment = whatsappEnvironment;
}
