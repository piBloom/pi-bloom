{
  config,
  fleet,
  inputs,
  lib,
  ...
}:
let
  aspects = ../..;
  nixRoot = ../../..;
  aspect = rel: aspects + "/${rel}/default.nix";
in
{
  imports = [
    inputs.disko.nixosModules.disko
    (nixRoot + "/hosts/nazar/hardware-configuration.nix")
    (nixRoot + "/hosts/nazar/disko.nix")
    (aspect "system/base")
    (aspect "users/admin")
    (aspect "access/ssh-host")
    (aspect "networking/host-uplink")
    (aspect "access/private-http")
    (aspect "development/tools")
    (aspect "networking/firewall")
    (aspect "agents/llm-agents")
    (aspect "agents/pi-agent-host")
    (aspect "services/nixpi")
    (aspect "services/code")
    (aspect "services/dav-server")
    (aspect "services/minecraft")
    (aspect "networking/service-proxy")
    (aspect "storage/backup")
    (aspect "monitoring/mdraid-smart")
  ];

  _module.args.minecraftContext = fleet.services.minecraft;

  systemd.tmpfiles.rules = [
    "d /persist/services/minecraft 0750 minecraft minecraft - -"
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
  ];
}
