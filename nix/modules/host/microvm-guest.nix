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
  guestShare =
    share:
    builtins.removeAttrs share [
      "owner"
      "group"
      "mode"
    ];
  sshHostKeyShare = {
    tag = "${vm.hostname}-ssh-host-keys";
    source = "/persist/microvms/${vm.hostname}/ssh";
    mountPoint = "/var/lib/nazar/ssh";
    proto = "virtiofs";
  };
  piAgentAuthShare = {
    tag = "nazar-pi-agent-auth";
    source = "/persist/microvms/shared/pi-agent";
    mountPoint = "/var/lib/nazar/pi-agent-auth";
    proto = "virtiofs";
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
    hypervisor = "cloud-hypervisor";
    vcpu = vm.cores;
    mem = vm.memoryMiB;
    user = null;
    socket = "${vm.hostname}.sock";
    vsock.cid = vm.vmid;
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
    ++ [
      sshHostKeyShare
    ]
    ++ lib.optional (vm.piAgent.enable or false) piAgentAuthShare
    ++ map guestShare (vm.microvm.shares or [ ]);
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
