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
    ../common/nixpi.nix
    ./microvm-guest.nix
  ];

  # OwnLoom provides its own Pi integration through its service module; every
  # other MicroVM gets the Nazar common Pi agent module here.
  commonPiAgentModules = [ ../common/pi-agent.nix ];

  serviceModules = {
    git = [
      ../services/forgejo.nix
      ../services/forgejo-bootstrap.nix
    ];
    minecraft = [ inputs.minecraft.nixosModules.minecraft-service ];
    ownloom = [ ../services/ownloom.nix ];
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
      imports =
        commonGuestModules
        ++ lib.optionals (name != "ownloom") commonPiAgentModules
        ++ serviceModules.${name};
    };
  };

  guestShareTmpfiles = lib.concatMap (
    vm:
    map (
      share:
      "d ${share.source} ${share.mode or "0755"} ${share.owner or "root"} ${share.group or "root"} - -"
    ) (vm.microvm.shares or [ ])
  ) (lib.attrValues fleet.vms);
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
      "ownloom"
    ];
    vms = lib.mapAttrs mkMicrovm fleet.vms;
  };

  systemd.tmpfiles.rules = [
    "d /persist/microvms 0755 root root - -"
    "d /persist/microvms-runtime 0775 microvm kvm - -"
  ]
  ++ guestShareTmpfiles;

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
