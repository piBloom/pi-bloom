{ fleet, ... }:
let
  hostIdentity = import ../../fleet/host.nix;
  public = hostIdentity.public;
in
{
  networking = {
    hostName = "nazar";
    domain = fleet.defaults.domain;
    useDHCP = false;
    useNetworkd = true;
    nameservers = [
      "1.1.1.1"
      "9.9.9.9"
    ];
  };

  systemd.network = {
    enable = true;
    wait-online.anyInterface = true;

    links."10-uplink-name" = {
      matchConfig.MACAddress = public.nicMac;
      linkConfig.Name = public.nicName;
    };

    networks."10-uplink" = {
      matchConfig.MACAddress = public.nicMac;
      addresses = [
        {
          Address = "${public.ipv4}/32";
          Peer = "${public.ipv4Gateway}/32";
        }
        { Address = public.ipv6; }
      ];
      routes = [
        {
          Gateway = public.ipv4Gateway;
          GatewayOnLink = true;
        }
        {
          Gateway = public.ipv6Gateway;
          GatewayOnLink = true;
        }
      ];
      networkConfig = {
        DHCP = "no";
        DNS = [
          "1.1.1.1"
          "9.9.9.9"
        ];
        IPv6AcceptRA = false;
      };
      linkConfig.RequiredForOnline = "routable";
    };
  };
}
