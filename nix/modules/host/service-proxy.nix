{
  fleet,
  lib,
  pkgs,
  ...
}:
let
  exposure = import ../../fleet/exposure.nix;
  privateIp = "10.44.0.1";
  publicIp = "167.235.12.22";
  hostSite = exposure.host.site or { };
  hostNixpi = exposure.host.nixpi or { };
  microvmUnits = map (name: "microvm@${name}.service") (lib.attrNames fleet.vms);
  perVmNixpiEnabled = lib.filterAttrs (name: _vm: exposure.vms.${name}.nixpi.enable or false) fleet.vms;

  isPublic = route: (route.access or "private") == "public";
  isRouted = route: route.enable or false;
  routeOnPrivateAccess =
    route:
    isRouted route
    && lib.elem (route.access or "private") [
      "private"
      "public"
    ];

  proxyBase = {
    proxyWebsockets = true;
    extraConfig = ''
      client_max_body_size 25m;
      proxy_read_timeout 3600s;
      proxy_send_timeout 3600s;
    '';
  };

  normalizePath = path: if lib.hasSuffix "/" path then path else "${path}/";
  exactPath = path: lib.removeSuffix "/" (normalizePath path);

  mkProxyLocation =
    route:
    proxyBase
    // {
      proxyPass = if route.stripPrefix or false then "${route.backend}/" else route.backend;
    }
    // lib.optionalAttrs (route.stripPrefix or false) {
      extraConfig = proxyBase.extraConfig + ''
        proxy_redirect / ${normalizePath route.path};
      '';
    };

  mkStaticLocation = route: {
    root = toString route.root;
    extraConfig = ''
      index ${route.index or "index.html"};
      try_files $uri $uri/ =404;
    '';
  };

  mkLocation = route: if route ? root then mkStaticLocation route else mkProxyLocation route;

  mkRouteLocations =
    route:
    if route.path == "/" then
      { "/" = mkLocation route; }
    else
      let
        path = normalizePath route.path;
      in
      {
        "= ${exactPath path}".return = "301 ${path}";
        ${path} = mkLocation (
          route
          // {
            path = path;
            stripPrefix = true;
          }
        );
      };

  mkLocations = routes: lib.foldl' (acc: route: acc // mkRouteLocations route) { } routes;

  domainsFor = vm: [ vm.dns ] ++ (vm.aliases or [ ]);

  serviceBackendFor =
    vm:
    if vm.service == "dav-server" then
      "http://${vm.ip}:${toString vm.davServer.httpPort}"
    else
      null;

  routesForVm =
    name: vm:
    let
      vmExposure = exposure.vms.${name} or { };
      serviceBackend = serviceBackendFor vm;
      # Service route: enable/access derived from fleet/vms.nix privateAccess
      serviceRoute = lib.optional (vm.privateAccess or false && serviceBackend != null) {
        name = "service";
        enable = true;
        path = "/";
        backend = serviceBackend;
        access = "private";
      };
      # NixPI is intentionally host-only. VM access happens through the host
      # workspace switcher over SSH into Pi agents, not per-VM HTTP services.
      nixpiRoute = [ ];
      subagentRoute = lib.optional (vmExposure.subagent.enable or false) {
        name = "subagent";
        enable = true;
        path = vmExposure.subagent.path or "/subagent/";
        backend = "http://${vm.ip}:${toString vmExposure.subagent.port}";
        access = vmExposure.subagent.access or "private";
        stripPrefix = true;
      };
    in
    serviceRoute ++ nixpiRoute ++ subagentRoute;

  mkVhost =
    {
      domain,
      addr,
      routes,
    }:
    {
      serverName = domain;
      listen = [
        {
          inherit addr;
          port = 80;
        }
      ];
      locations = mkLocations routes;
    };

  mkDomainVhosts =
    domain: routes:
    let
      privateRoutes = lib.filter routeOnPrivateAccess routes;
      publicRoutes = lib.filter (route: isRouted route && isPublic route) routes;
    in
    (lib.optional (privateRoutes != [ ]) {
      name = "${domain}-private";
      value = mkVhost {
        inherit domain;
        addr = privateIp;
        routes = privateRoutes;
      };
    })
    ++ (lib.optional (publicRoutes != [ ]) {
      name = "${domain}-public";
      value = mkVhost {
        inherit domain;
        addr = publicIp;
        routes = publicRoutes;
      };
    });

  vmDomainVhosts = lib.concatMap (
    name:
    let
      vm = fleet.vms.${name};
      routes = routesForVm name vm;
    in
    lib.concatMap (domain: mkDomainVhosts domain routes) (domainsFor vm)
  ) (lib.attrNames fleet.vms);

  hostSiteRoute = {
    name = "host-site";
    enable = hostSite.enable or false;
    path = hostSite.path or "/";
    root = hostSite.root or ../../../www/nazar-dashboard;
    access = hostSite.access or "private";
  };

  hostNixpiRoute = {
    name = "host-nixpi";
    enable = hostNixpi.enable or false;
    path = "/";
    backend = "http://127.0.0.1:${toString (hostNixpi.port or 4815)}";
    access = hostNixpi.access or "private";
    stripPrefix = false;
  };

  # When nixpi has a dedicated domain, it gets its own vhost.
  # When nixpi uses pathDomains (legacy), it's merged into the host site vhost.
  nixpiOwnDomain = hostNixpi.domain or null;
  nixpiPathDomains = hostNixpi.pathDomains or [ ];
  nixpiTunnelAliases = hostNixpi.localTunnelAliases or [ ];

  # Legacy path-based route (used when pathDomains is set)
  hostNixpiPathRoute = {
    name = "host-nixpi-path";
    enable = hostNixpi.enable or false;
    path = hostNixpi.path or "/nixpi/";
    backend = "http://127.0.0.1:${toString (hostNixpi.port or 4815)}";
    access = hostNixpi.access or "private";
    stripPrefix = true;
  };

  # Host domains: site domain + nixpi path domains (legacy mode only)
  hostDomains = lib.unique (
    (lib.optional (hostSite ? domain) hostSite.domain)
    ++ nixpiPathDomains
  );

  routesForHostDomain =
    domain:
    (lib.optional ((hostSite.enable or false) && (hostSite.domain or null) == domain) hostSiteRoute)
    ++ (lib.optional (
      (hostNixpi.enable or false) && nixpiPathDomains != [ ] && lib.elem domain nixpiPathDomains
    ) hostNixpiPathRoute);

  hostDomainVhosts = lib.concatMap (
    domain: mkDomainVhosts domain (routesForHostDomain domain)
  ) hostDomains;

  # Dedicated nixpi domain vhost (new mode)
  nixpiDomainVhosts = lib.optionals (nixpiOwnDomain != null && (hostNixpi.enable or false)) (
    mkDomainVhosts nixpiOwnDomain [ hostNixpiRoute ]
  );
  nixpiTunnelAliasVhosts = lib.optionals ((hostNixpi.enable or false) && nixpiTunnelAliases != [ ]) (
    lib.concatMap (domain: mkDomainVhosts domain [ (hostNixpiRoute // { access = "private"; }) ]) nixpiTunnelAliases
  );
  allRouteLists = [
    [ hostSiteRoute hostNixpiRoute ]
  ]
  ++ (map (name: routesForVm name fleet.vms.${name}) (lib.attrNames fleet.vms));
  publicHttpEnabled = lib.any (
    routes: lib.any (route: isRouted route && isPublic route) routes
  ) allRouteLists;
in
{
  services.nginx = {
    enable = true;
    recommendedGzipSettings = true;
    recommendedOptimisation = true;
    recommendedProxySettings = true;

    virtualHosts = lib.listToAttrs (hostDomainVhosts ++ nixpiDomainVhosts ++ nixpiTunnelAliasVhosts ++ vmDomainVhosts);
  };

  systemd.services.nginx = {
    after = [
      "network-online.target"
      "nixpi.service"
    ]
    ++ microvmUnits;
    wants = [ "network-online.target" ];
  };

  networking.firewall.allowedTCPPorts = lib.mkIf publicHttpEnabled [ 80 ];

  assertions = [
    {
      assertion = perVmNixpiEnabled == { };
      message = "NixPI runs only on Nazar. Remove exposure.vms.<name>.nixpi and use the host NixPI workspace switcher instead.";
    }
  ];
}
