{
  pkgs,
  lib,
  self,
}:

{
  mkBaseNode =
    extraConfig:
    {
      virtualisation = {
        diskSize = lib.mkDefault 20480;
        memorySize = lib.mkDefault 4096;
        graphics = lib.mkDefault false;
      };
      boot.loader = {
        systemd-boot.enable = lib.mkDefault true;
        efi.canTouchEfiVariables = lib.mkDefault true;
      };
      networking = {
        hostName = lib.mkDefault "nixos";
        networkmanager.enable = lib.mkDefault true;
      };
      time.timeZone = lib.mkDefault "UTC";
      i18n.defaultLocale = lib.mkDefault "en_US.UTF-8";
      system.stateVersion = lib.mkDefault "25.05";
    }
    // extraConfig;

  mkManagedUserConfig =
    {
      username,
      homeDir ? "/home/${username}",
      extraGroups ? [
        "wheel"
        "networkmanager"
      ],
    }:
    {
      nixpi.primaryUser = username;

      users.users.${username} = {
        isNormalUser = true;
        group = username;
        inherit extraGroups;
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = { };
    };

  mkTestFilesystems = {
    fileSystems."/" = {
      device = "/dev/vda";
      fsType = "ext4";
    };
    fileSystems."/boot" = {
      device = "/dev/vda1";
      fsType = "vfat";
    };
  };

  nixPiModules = [
    self.nixosModules.nixpi
    { nixpi.security.ssh.allowedSourceCIDRs = [ "192.0.2.10/32" ]; }
  ];

  nixPiModulesNoShell = [
    self.nixosModules.nixpi
    { nixpi.shell.enable = false; }
    { nixpi.security.ssh.allowedSourceCIDRs = [ "192.0.2.10/32" ]; }
  ];

}
