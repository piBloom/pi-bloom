# nix/checks.nix — NixPI check sets: smoke, full, destructive, and topology guards
{ self, pkgs, pkgsUnfree, lib, system }:
let
  nixosTests = import ../tests/nixos {
    pkgs = pkgsUnfree;
    inherit lib self;
  };
  nixpiBootstrapDefaultInput =
    if self ? rev then
      "github:alexradunet/nixpi/${self.rev}"
    else
      "github:alexradunet/nixpi";
  bootstrapHostWrapperDefaultInputCheck = pkgs.runCommandLocal "bootstrap-host-wrapper-default-input-check" { } ''
    wrapper="${self.packages.${system}.nixpi-bootstrap-host}/bin/nixpi-bootstrap-host"
    test -f "$wrapper"
    grep -F 'NIXPI_DEFAULT_INPUT' "$wrapper" >/dev/null
    grep -F '${nixpiBootstrapDefaultInput}' "$wrapper" >/dev/null
    ! grep -F -- '-dirty' "$wrapper" >/dev/null
    ! grep -F 'path:/nix/store/' "$wrapper" >/dev/null
    touch "$out"
  '';
  nixpiBootstrapHostCheck = pkgs.linkFarm "nixpi-bootstrap-host-check" [
    {
      name = "wrapper-default-input";
      path = bootstrapHostWrapperDefaultInputCheck;
    }
    {
      name = "vm";
      path = nixosTests.nixpi-bootstrap-host;
    }
  ];
  bootCheck = pkgsUnfree.testers.runNixOSTest {
    name = "boot";

    nodes.nixpi =
      { ... }:
      {
        imports = [
          self.nixosModules.nixpi
        ];

        nixpi.primaryUser = "alex";
        nixpi.security.ssh.allowedSourceCIDRs = [ "192.0.2.10/32" ];

        networking.hostName = "nixos";
        system.stateVersion = "25.05";
        boot.loader.systemd-boot.enable = true;
        boot.loader.efi.canTouchEfiVariables = true;
        fileSystems."/" = {
          device = "/dev/vda";
          fsType = "ext4";
        };
        fileSystems."/boot" = {
          device = "/dev/vda1";
          fsType = "vfat";
        };

        # Give the VM enough disk for the NixPI closure
        virtualisation.diskSize = 20480; # 20 GB
        virtualisation.memorySize = 4096;
      };

    testScript = ''
      nixpi = machines[0]

      nixpi.start()
      nixpi.wait_for_unit("multi-user.target", timeout=300)

      # Basic sanity: the default operator exists and the core service surface is installed
      nixpi.succeed("id alex")

      # NetworkManager is running
      nixpi.succeed("systemctl is-active NetworkManager")
    '';
  };
  mkCheckLane = name: entries: pkgs.linkFarm name entries;
in
{
  exported-topology =
    assert builtins.hasAttr "aarch64-linux" self.packages;
    assert builtins.hasAttr "nixpi-app-setup" self.nixosConfigurations.installed-test.config.systemd.services;
    pkgs.runCommandLocal "exported-topology-check" { } ''
      touch "$out"
    '';

  # Fast: build the installed system closure locally — catches locale
  # errors, module conflicts, bad package references, and NixOS
  # evaluation failures without touching QEMU.
  config = self.nixosConfigurations.installed-test.config.system.build.toplevel;

  flake-topology = pkgs.runCommandLocal "flake-topology-check" { } ''
    ! grep -F 'desktop-vm' ${../flake.nix}
    ! test -e ${../.}/core/os/hosts/x86_64-vm.nix
    ! test -e ${../.}/tools/run-qemu.sh
    ! test -e ${../.}/core/os/hosts/rpi-common.nix
    ! test -e ${../.}/core/os/hosts/rpi4.nix
    ! test -e ${../.}/core/os/hosts/rpi5.nix
    touch "$out"
  '';

  vps-topology = pkgs.runCommandLocal "vps-topology-check" { } ''
    grep -F 'nixosConfigurations.vps' ${../flake.nix} >/dev/null
    ! grep -F 'nixosConfigurations.rpi4' ${../flake.nix} >/dev/null
    ! grep -F 'nixosConfigurations.rpi5' ${../flake.nix} >/dev/null
    ! grep -F 'nixosConfigurations.nixpi = self.nixosConfigurations.vps' ${../flake.nix} >/dev/null
    ! grep -F 'Managed NixPI desktop profile' ${../flake.nix} >/dev/null
    grep -F './core/os/hosts/vps.nix' ${../flake.nix} >/dev/null
    ! grep -F 'primaryUser = lib.mkDefault "human";' ${../core/os/hosts/vps.nix} >/dev/null
    grep -F 'headless VPS profile' ${../core/os/hosts/vps.nix} >/dev/null
    grep -F 'enableRedistributableFirmware' ${../core/os/hosts/vps.nix} >/dev/null
    grep -F 'self.nixosModules.nixpi' ${../nix/hosts.nix} >/dev/null
    sed -n '/bootCheck = pkgsUnfree.testers.runNixOSTest {/,/mkCheckLane = name: entries:/p' ${../nix/checks.nix} \
      | grep -F 'self.nixosModules.nixpi' >/dev/null
    smoke_block="$(sed -n '/nixos-smoke = mkCheckLane "nixos-smoke" \[/,/nixos-full = mkCheckLane "nixos-full" \[/p' ${../nix/checks.nix})"
    ! printf '%s\n' "$smoke_block" | grep -F 'name = "nixpi-vps-bootstrap";' >/dev/null
    printf '%s\n' "$smoke_block" | grep -F 'name = "nixpi-runtime";' >/dev/null
    printf '%s\n' "$smoke_block" | grep -F 'name = "nixpi-security";' >/dev/null
    printf '%s\n' "$smoke_block" | grep -F 'name = "nixpi-broker";' >/dev/null
    runtime_line="$(printf '%s\n' "$smoke_block" | grep -nF 'name = "nixpi-runtime";' | cut -d: -f1)"
    security_line="$(printf '%s\n' "$smoke_block" | grep -nF 'name = "nixpi-security";' | cut -d: -f1)"
    broker_line="$(printf '%s\n' "$smoke_block" | grep -nF 'name = "nixpi-broker";' | cut -d: -f1)"
    test "$runtime_line" -lt "$security_line"
    test "$security_line" -lt "$broker_line"
    grep -F 'enableRedistributableFirmware' ${../core/os/hosts/vps.nix} >/dev/null
    touch "$out"
  '';

  vps-console-config = pkgs.runCommandLocal "vps-console-config-check" { } ''
    params='${lib.concatStringsSep " " self.nixosConfigurations.vps.config.boot.kernelParams}'
    printf '%s\n' "$params" | grep -Eq '(^| )console=tty0($| )'
    printf '%s\n' "$params" | grep -Eq '(^| )console=ttyS0,115200($| )'
    test '${
      if self.nixosConfigurations.vps.config.systemd.services."getty@tty1".enable then "true" else "false"
    }' = true
    touch "$out"
  '';

  # Thorough: boot the installed system in a NixOS test VM and verify
  # that critical services come up.
  boot = bootCheck;

  nixos-smoke = mkCheckLane "nixos-smoke" [
    {
      name = "nixpi-runtime";
      path = nixosTests.nixpi-runtime;
    }
    {
      name = "nixpi-security";
      path = nixosTests.nixpi-security;
    }
    {
      name = "nixpi-broker";
      path = nixosTests.nixpi-broker;
    }
  ];

  nixos-full = mkCheckLane "nixos-full" [
    {
      name = "boot";
      path = bootCheck;
    }
    {
      name = "nixpi-firstboot";
      path = nixosTests.nixpi-firstboot;
    }
    {
      name = "nixpi-system-flake";
      path = nixosTests.nixpi-system-flake;
    }
    {
      name = "nixpi-bootstrap-host";
      path = nixosTests.nixpi-bootstrap-host;
    }
    {
      name = "nixpi-network";
      path = nixosTests.nixpi-network;
    }
    {
      name = "nixpi-e2e";
      path = nixosTests.nixpi-e2e;
    }
    {
      name = "nixpi-security";
      path = nixosTests.nixpi-security;
    }
    {
      name = "nixpi-modular-services";
      path = nixosTests.nixpi-modular-services;
    }
    {
      name = "nixpi-post-setup-lockdown";
      path = nixosTests.nixpi-post-setup-lockdown;
    }
    {
      name = "nixpi-broker";
      path = nixosTests.nixpi-broker;
    }
    {
      name = "nixpi-update";
      path = nixosTests.nixpi-update;
    }
    {
      name = "nixpi-options-validation";
      path = nixosTests.nixpi-options-validation;
    }
  ];

  nixos-destructive = mkCheckLane "nixos-destructive" [
    {
      name = "nixpi-post-setup-lockdown";
      path = nixosTests.nixpi-post-setup-lockdown;
    }
    {
      name = "nixpi-broker";
      path = nixosTests.nixpi-broker;
    }
  ];

  bootstrap-host-wrapper-default-input = bootstrapHostWrapperDefaultInputCheck;
}
// nixosTests
// {
  nixpi-bootstrap-host = nixpiBootstrapHostCheck;
}
