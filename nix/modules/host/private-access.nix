{ fleet, lib, ... }:
let
  exposure = import ../../fleet/exposure.nix;
  privateIp = "10.44.0.1";

  isPrivateAccess =
    route:
    (route.enable or false)
    && lib.elem (route.access or "private") [
      "private"
      "public"
    ];

  domainsFor = vm: [ vm.dns ] ++ (vm.aliases or [ ]);
  hostSite = exposure.host.site or { };
  hostNixpi = exposure.host.nixpi or { };

  vmHasPrivateRoute =
    name:
    let
      vmExposure = exposure.vms.${name} or { };
    in
    lib.any isPrivateAccess [
      (vmExposure.service or { })
    ];

  privateServiceDomains = lib.concatMap (
    name: if vmHasPrivateRoute name then domainsFor fleet.vms.${name} else [ ]
  ) (lib.attrNames fleet.vms);

  hostSiteDomains = lib.optional (isPrivateAccess hostSite && hostSite ? domain) hostSite.domain;

  hostNixpiDomains = lib.optionals (isPrivateAccess hostNixpi) (
    lib.optional (hostNixpi ? domain) hostNixpi.domain
    ++ (hostNixpi.pathDomains or [ ])
  );

  privateDomainExclusions = exposure.privateDomainExclusions or [ ];
  privateDomains = lib.subtractLists privateDomainExclusions (
    lib.unique (privateServiceDomains ++ hostSiteDomains ++ hostNixpiDomains)
  );
in
{
  # Private services bind to a host-local dummy address. sshuttle clients route
  # this address over SSH, while the address is never exposed on the public NIC.
  systemd.network.netdevs."20-nazar-private" = {
    netdevConfig = {
      Name = "nazar-private";
      Kind = "dummy";
    };
  };

  systemd.network.networks."20-nazar-private" = {
    matchConfig.Name = "nazar-private";
    addresses = [ { Address = "${privateIp}/32"; } ];
    networkConfig = {
      DHCP = "no";
      LinkLocalAddressing = "no";
    };
    linkConfig.RequiredForOnline = "no";
  };

  # Keep host-local commands aligned with the same private service view that
  # sshuttle clients get declaratively in nix/modules/laptop/nazar-sshuttle.nix.
  networking.hosts.${privateIp} = privateDomains;
}
