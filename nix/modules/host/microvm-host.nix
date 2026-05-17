{
  fleet,
  inputs,
  lib,
  pkgs,
  ...
}:
let
  commonGuestModules = [
    inputs.microvm.nixosModules.microvm
    ../guest/base.nix
    ../guest/users.nix
    ../guest/security.nix
    ../guest/development.nix
    ./microvm-guest.nix
  ];

  # Pi agent is now opt-in per VM via vm.piAgent.enable.
  # Removed ../guest/nixpi.nix — NixPi runs centrally on the host.
  commonPiAgentModule = ../guest/pi-agent.nix;

  # Identity modules: small local overrides (UID/GID, tmpfs root) that complement
  # the canonical service module from the upstream flake input.
  identityModules = {
    minecraft = ../services/minecraft-identity.nix;
    dav-server = ../services/dav-server-identity.nix;
  };

  # Flake input name for each service — used to resolve the canonical NixOS module.
  flakeInputModule = {
    minecraft = inputs.minecraft.nixosModules.minecraft-service;
    dav-server = inputs.dav-server.nixosModules.dav-server-service;
  };

  # Derive serviceModules from fleet/vms.nix metadata.
  serviceModules = lib.mapAttrs (name: vm: [
    identityModules.${name}
    flakeInputModule.${name}
  ]) fleet.vms;

  hostMicrovmSshConfig = lib.concatStringsSep "\n" (
    lib.mapAttrsToList (_name: vm: ''
      Host ${vm.hostname} ${vm.hostname}.${fleet.defaults.domain} ${vm.ip}
        HostName ${vm.ip}
        User alex
        IdentityFile /home/alex/.ssh/id_ed25519
        IdentitiesOnly yes
        UserKnownHostsFile /home/alex/.ssh/nazar_microvm_known_hosts
        StrictHostKeyChecking accept-new
    '') fleet.vms
  );

  mkMicrovm = name: vm: {
    inherit pkgs;
    autostart = false;
    restartIfChanged = false;
    specialArgs = {
      inherit inputs fleet vm;
    };
    config = {
      imports = commonGuestModules
        ++ lib.optional (vm.piAgent.enable or false) commonPiAgentModule
        ++ serviceModules.${name};
    };
  };

  tmpfileForShare =
    share:
    "d ${share.source} ${share.mode or "0755"} ${share.owner or "root"} ${share.group or "root"} - -";
  guestShareTmpfiles = lib.concatMap (vm: map tmpfileForShare (vm.microvm.shares or [ ])) (
    lib.attrValues fleet.vms
  );
  sshHostKeyShareTmpfiles = map (vm: "d /persist/microvms/${vm.hostname}/ssh 0700 root root - -") (
    lib.attrValues fleet.vms
  );
in
{
  imports = [ inputs.microvm.nixosModules.host ];

  microvm = {
    stateDir = "/persist/microvms-runtime";
    autostart = [
      "minecraft"
      "dav-server"
    ];
    vms = lib.mapAttrs mkMicrovm fleet.vms;
  };

  systemd.tmpfiles.rules = [
    "d /persist/microvms 0755 root root - -"
    "d /persist/microvms/shared 0750 alex users - -"
    "d /persist/microvms/shared/pi-agent 0700 alex users - -"
    "d /persist/microvms-runtime 0775 microvm kvm - -"
    "d /home/alex/.ssh 0700 alex users - -"
    "f /home/alex/.ssh/nazar_microvm_known_hosts 0600 alex users - -"
  ]
  ++ guestShareTmpfiles
  ++ sshHostKeyShareTmpfiles;

  programs.ssh.extraConfig = hostMicrovmSshConfig;

  environment.systemPackages = [
    pkgs.cloud-hypervisor
    pkgs.virtiofsd
  ];

  assertions = [
    {
      assertion = lib.all (name: builtins.hasAttr name serviceModules) (lib.attrNames fleet.vms);
      message = "Every concrete fleet VM must have a MicroVM service module mapping.";
    }
  ];
}
