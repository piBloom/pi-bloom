{
  config,
  inputs,
  lib,
  ...
}:
{
  imports = [
    inputs.disko.nixosModules.disko
    ./hardware-configuration.nix
    ./disko.nix
    ../../modules/host/base.nix
    ../../modules/host/users.nix
    ../../modules/host/ssh.nix
    ../../modules/host/networking.nix
    ../../modules/host/tailscale.nix
    ../../modules/guest/development.nix
    ../../modules/host/firewall.nix
    ../../modules/host/llm-agents.nix
    inputs.hermes-agent.nixosModules.default
    ../../modules/host/hermes-agent.nix
    ../../modules/host/hermes-dashboard.nix
    ../../modules/host/life-os.nix
    ../../modules/host/backup.nix
    ../../modules/host/monitoring.nix
  ];

  networking.hostId = "16723512";

  boot.loader.systemd-boot.enable = lib.mkForce false;
  boot.loader.efi.canTouchEfiVariables = lib.mkForce false;
  boot.loader.grub = {
    enable = true;
    efiSupport = false;
    devices = lib.mkForce [
      "/dev/disk/by-id/nvme-SAMSUNG_MZVL2512HCJQ-00B00_S675NX0T505998"
      "/dev/disk/by-id/nvme-SAMSUNG_MZVL2512HCJQ-00B00_S675NX0T505978"
    ];
  };

  boot.initrd.availableKernelModules = [
    "nvme"
    "ahci"
    "xhci_pci"
    "usbhid"
    "sd_mod"
  ];

  boot.swraid = {
    enable = true;
    mdadmConf = ''
      MAILADDR root
    '';
  };

  zramSwap = {
    enable = true;
    memoryPercent = 25;
  };

  system.stateVersion = "26.05";

  assertions = [
    {
      assertion = config.networking.hostName == "nazar";
      message = "The bare-metal host configuration must keep hostname nazar.";
    }
    {
      assertion = config.systemd.services.hermes-dashboard.enable or false;
      message = "Nazar must keep hermes-dashboard.service enabled for laptop browser access.";
    }
    {
      assertion = builtins.elem "multi-user.target" (
        config.systemd.services.hermes-dashboard.wantedBy or [ ]
      );
      message = "Nazar must start hermes-dashboard.service automatically at boot.";
    }
  ];
}
