{
  config,
  inputs,
  pkgs,
  ...
}:
let
  hermesPkgs = inputs.hermes-agent.inputs.nixpkgs.legacyPackages.${pkgs.stdenv.hostPlatform.system};
  hermesAgentWithVoice =
    inputs.hermes-agent.packages.${pkgs.stdenv.hostPlatform.system}.default.override
      {
        extraPythonPackages = with hermesPkgs.python312Packages; [
          numpy
          (sounddevice.overridePythonAttrs (old: {
            dependencies = builtins.filter (dep: (dep.pname or "") != "cffi") (old.dependencies or [ ]);
            propagatedBuildInputs = builtins.filter (dep: (dep.pname or "") != "cffi") (
              old.propagatedBuildInputs or [ ]
            );
          }))
        ];
      };
in
{
  imports = [
    ./hardware-configuration.nix
    ../../modules/laptop/nazar-tunnel.nix
    ../../modules/laptop/tailscale.nix
    ../../modules/laptop/life-os-client.nix
  ];

  networking.hostName = "alex-laptop";
  networking.networkmanager.enable = true;

  nazar.access.tunnel.enable = true;
  nazar.lifeOs.client = {
    enable = true;
    davUrl = "http://nazar.ojos-sargas.ts.net/life/";
    caldav.url = "http://nazar.ojos-sargas.ts.net:5232/";
  };

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  hardware.bluetooth = {
    enable = true;
    powerOnBoot = true;
  };
  services.blueman.enable = true;

  time.timeZone = "Europe/Bucharest";
  i18n.defaultLocale = "en_US.UTF-8";
  i18n.extraLocaleSettings = {
    LC_ADDRESS = "ro_RO.UTF-8";
    LC_IDENTIFICATION = "ro_RO.UTF-8";
    LC_MEASUREMENT = "ro_RO.UTF-8";
    LC_MONETARY = "ro_RO.UTF-8";
    LC_NAME = "ro_RO.UTF-8";
    LC_NUMERIC = "ro_RO.UTF-8";
    LC_PAPER = "ro_RO.UTF-8";
    LC_TELEPHONE = "ro_RO.UTF-8";
    LC_TIME = "ro_RO.UTF-8";
  };

  services.xserver.enable = true;
  services.displayManager.sddm.enable = true;
  services.desktopManager.plasma6.enable = true;
  services.xserver.xkb = {
    layout = "us";
    variant = "";
  };

  services.printing.enable = true;

  services.pulseaudio.enable = false;
  security.rtkit.enable = true;
  services.pipewire = {
    enable = true;
    alsa.enable = true;
    alsa.support32Bit = true;
    pulse.enable = true;
  };

  users.users.alex = {
    isNormalUser = true;
    description = "alex";
    extraGroups = [
      "networkmanager"
      "wheel"
    ];
    packages = with pkgs; [ kdePackages.kate ];
  };

  nixpkgs.config.allowUnfree = true;
  nix.settings = {
    experimental-features = [
      "nix-command"
      "flakes"
    ];
    trusted-users = [
      "root"
      "@wheel"
    ];
  };
  security.sudo.wheelNeedsPassword = false;

  environment.systemPackages = with pkgs; [
    chromium
    curl
    ghostty
    gh
    git
    htop
    jdk25
    jq
    nodejs
    prismlauncher
    ktailctl
    tmux
    vim
    vscodium
    wget
    hermesAgentWithVoice
  ];

  assertions = [
    {
      assertion = config.nazar.access.tunnel.enable;
      message = "alex-laptop must keep nazar.access.tunnel enabled so http://127.0.0.1:9119/chat reaches Nazar.";
    }
    {
      assertion = config.systemd.services.nazar-tunnel.enable or false;
      message = "alex-laptop must keep nazar-tunnel.service enabled.";
    }
    {
      assertion = builtins.elem "multi-user.target" (
        config.systemd.services.nazar-tunnel.wantedBy or [ ]
      );
      message = "alex-laptop must start nazar-tunnel.service automatically at boot.";
    }
    {
      assertion = config.services.tailscale.enable;
      message = "alex-laptop must keep Tailscale enabled for private Nazar access.";
    }
    {
      assertion = config.services.tailscale.useRoutingFeatures == "client";
      message = "alex-laptop must use Tailscale client mode unless routing behavior is explicitly designed.";
    }
  ];

  system.stateVersion = "25.11";
}
