{ pkgs, ... }:
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
    };

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
      openssh
      python3
      ripgrep
    ];
  };

  # Keep the module's default workspace under /var/lib/hermes so activation does
  # not change /home/alex permissions, but allow the private gateway to work on
  # alex-owned repos when explicitly asked.
  systemd.services.hermes-agent.serviceConfig.ReadWritePaths = [ "/home/alex" ];
}
