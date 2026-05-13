{
  fleet,
  lib,
  ...
}:
let
  exposure = import ../../fleet/exposure.nix;

  isPrivateAccess = route:
    (route.enable or false) && lib.elem (route.access or "wireguard") [
      "wireguard"
      "public"
    ];

  domainsFor = vm: [ vm.dns ] ++ (vm.aliases or [ ]);

  vmHasPrivateRoute = name:
    let
      vmExposure = exposure.vms.${name} or { };
    in
    lib.any isPrivateAccess [
      (vmExposure.service or { })
      (vmExposure.nixpi or { })
      (vmExposure.subagent or { })
    ];

  privateServiceDomains = lib.concatMap (
    name:
    if vmHasPrivateRoute name then domainsFor fleet.vms.${name} else [ ]
  ) (lib.attrNames fleet.vms);

  privateNixpiDomains = lib.concatMap (
    name:
    let
      vm = fleet.vms.${name};
      vmExposure = exposure.vms.${name} or { };
    in
    lib.optional (isPrivateAccess (vmExposure.nixpi or { })) vm.nixpi.dns
  ) (lib.attrNames fleet.vms);

  hostNixpiDomains = lib.optional (isPrivateAccess (exposure.host.nixpi or { })) exposure.host.nixpi.domain;

  privateDomains = lib.unique (privateServiceDomains ++ privateNixpiDomains ++ hostNixpiDomains);
in
{
  networking.wireguard.useNetworkd = false;

  # Keep the host itself aligned with the WireGuard-private DNS view so local
  # deploy/push commands use the private proxies instead of public DNS.
  networking.hosts."10.44.0.1" = privateDomains;

  networking.wireguard.interfaces.wg0 = {
    ips = [ "10.44.0.1/24" ];
    listenPort = 51820;
    privateKeyFile = "/var/lib/nazar/wireguard/wg0.key";
    generatePrivateKeyFile = true;

    peers = [
      {
        # Alex laptop
        publicKey = "uIxa1lOPgLXK9uCx5laM+Nu8bZKpcEDSbINpOHmBlHs=";
        allowedIPs = [ "10.44.0.2/32" ];
      }

      {
        # Alex mobile
        publicKey = "z0tbLoUVfdLvn1omEzE5KoY8qgMsnYfHGBYN3gr1o1c=";
        allowedIPs = [ "10.44.0.3/32" ];
      }

      # Add more WireGuard clients here, using only public keys and per-client /32s.
      # Next suggested address: 10.44.0.4/32.
    ];
  };

  services.dnsmasq = {
    enable = true;
    resolveLocalQueries = false;
    settings = {
      interface = "wg0";
      bind-interfaces = true;
      listen-address = "10.44.0.1";
      no-resolv = true;
      domain-needed = true;
      bogus-priv = true;
      server = [
        "1.1.1.1"
        "9.9.9.9"
      ];
      address = map (domain: "/${domain}/10.44.0.1") privateDomains;
    };
  };

  systemd.services.dnsmasq = {
    after = [ "wireguard-wg0.service" ];
    wants = [ "wireguard-wg0.service" ];
  };

  networking.firewall = {
    allowedUDPPorts = [ 51820 ];
    interfaces.wg0 = {
      allowedTCPPorts = [
        22
        53
      ];
      allowedUDPPorts = [ 53 ];
    };
  };
}
