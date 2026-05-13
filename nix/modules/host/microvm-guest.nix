{
  fleet,
  lib,
  vm,
  ...
}:
let
  gateway = fleet.defaults.gateway;
  dnsServers = fleet.defaults.nameservers;
  serviceExtraTcpPorts = {
    dav-server = [ (vm.davServer.httpPort or 80) ];
  };
in
{
  networking = {
    hostName = vm.hostname;
    domain = fleet.defaults.domain;
    useDHCP = false;
    useNetworkd = true;
    nameservers = dnsServers;
  };

  systemd.network = {
    enable = true;
    networks."10-microvm" = {
      matchConfig.MACAddress = vm.microvm.mac;
      addresses = [ { Address = "${vm.ip}/32"; } ];
      routes = [
        {
          Destination = "${gateway}/32";
          GatewayOnLink = true;
        }
        {
          Destination = "0.0.0.0/0";
          Gateway = gateway;
          GatewayOnLink = true;
        }
      ];
      networkConfig = {
        DHCP = "no";
        DNS = dnsServers;
      };
      linkConfig.RequiredForOnline = "routable";
    };
  };

  microvm = {
    hypervisor = "qemu";
    vcpu = vm.cores;
    # microvm.nix warns that QEMU can hang at exactly 2048 MiB.
    mem = if vm.memoryMiB == 2048 then 2304 else vm.memoryMiB;
    # microvm.nix currently emits QEMU's obsolete/unsupported `-user` flag for
    # this option with our pinned qemu (10.x). Keep this null so MicroVMs boot;
    # the host unit and device permissions still isolate state under /persist.
    user = null;
    socket = "${vm.hostname}.sock";
    interfaces = [
      {
        type = "tap";
        id = vm.microvm.tap;
        mac = vm.microvm.mac;
        tap.vhost = true;
      }
    ];
    shares = [
      {
        tag = "ro-store";
        source = "/nix/store";
        mountPoint = "/nix/.ro-store";
        proto = "virtiofs";
        readOnly = true;
      }
    ]
    ++ (vm.microvm.shares or [ ]);
  };

  networking.firewall.allowedTCPPorts = lib.mkAfter (serviceExtraTcpPorts.${vm.hostname} or [ ]);

  boot.kernelParams = [ "console=ttyS0" ];
  system.stateVersion = "26.05";

  assertions = [
    {
      assertion = vm ? microvm && vm.microvm ? tap && vm.microvm ? mac;
      message = "MicroVM guest ${vm.hostname} requires microvm.tap and microvm.mac in nix/fleet/vms.nix.";
    }
  ];
}
