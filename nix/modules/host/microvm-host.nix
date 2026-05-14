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
    inputs.sops-nix.nixosModules.sops
    ../common/base.nix
    ../common/users.nix
    ../common/security.nix
    ../common/development.nix
    ../common/sops.nix
    ../common/nazar-context.nix
    ./microvm-guest.nix
  ];

  # Pi agent is now opt-in per VM via vm.piAgent.enable.
  # Removed ../common/nixpi.nix — NixPi runs centrally on the host.
  commonPiAgentModules = [ ../common/pi-agent.nix ];

  serviceModules = {
    git = [
      ../services/forgejo.nix
      ../services/forgejo-bootstrap.nix
    ];
    minecraft = [
      ../services/minecraft-identity.nix
      inputs.minecraft.nixosModules.minecraft-service
    ];
    dav-server = [ ../services/dav-server.nix ];
  };

  mkMicrovm = name: vm: {
    inherit pkgs;
    autostart = false;
    restartIfChanged = false;
    specialArgs = {
      inherit inputs fleet vm;
    };
    config = {
      imports = commonGuestModules
        ++ lib.optional (vm.piAgent.enable or false) commonPiAgentModules
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
    # Bring persistent services back automatically. DAV remains deliberately
    # started only when its data/secrets are restored and validated.
    autostart = [
      "git"
      "minecraft"
      "dav-server"
    ];
    vms = lib.mapAttrs mkMicrovm fleet.vms;
  };

  systemd.tmpfiles.rules = [
    "d /persist/microvms 0755 root root - -"
    "d /persist/microvms-runtime 0775 microvm kvm - -"
  ]
  ++ guestShareTmpfiles
  ++ sshHostKeyShareTmpfiles;

  environment.systemPackages = [
    pkgs.qemu_kvm
    pkgs.virtiofsd
  ];

  assertions = [
    {
      assertion = lib.all (name: builtins.hasAttr name serviceModules) (lib.attrNames fleet.vms);
      message = "Every concrete fleet VM must have a MicroVM service module mapping.";
    }
  ];
}
