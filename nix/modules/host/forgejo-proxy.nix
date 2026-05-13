{
  fleet,
  lib,
  pkgs,
  ...
}:
let
  exposure = import ../../fleet/exposure.nix;
  wireguardIp = "10.44.0.1";
  publicIp = "167.235.12.22";
  git = fleet.vms.git;
  microvmUnits = map (name: "microvm@${name}.service") (lib.attrNames fleet.vms);

  isPublic = route: (route.access or "wireguard") == "public";
  isRouted = route: route.enable or false;
  routeOnWireguard = route: isRouted route && lib.elem (route.access or "wireguard") [
    "wireguard"
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

  mkProxyLocation = route:
    proxyBase
    // {
      proxyPass =
        if route.stripPrefix or false then
          "${route.backend}/"
        else
          route.backend;
    }
    // lib.optionalAttrs (route.stripPrefix or false) {
      extraConfig = proxyBase.extraConfig + ''
        proxy_redirect / ${normalizePath route.path};
      '';
    };

  mkRouteLocations = route:
    if route.path == "/" then
      { "/" = mkProxyLocation route; }
    else
      let
        path = normalizePath route.path;
      in
      {
        "= ${exactPath path}".return = "301 ${path}";
        ${path} = mkProxyLocation (route // {
          path = path;
          stripPrefix = true;
        });
      };

  mkLocations = routes: lib.foldl' (acc: route: acc // mkRouteLocations route) { } routes;

  domainsFor = vm: [ vm.dns ] ++ (vm.aliases or [ ]);

  serviceBackendFor = vm:
    if vm.service == "forgejo" then
      "http://${vm.ip}:${toString vm.webPort}"
    else if vm.service == "ownloom" then
      "http://${vm.ip}:${toString (vm.ownloom.web.httpPort or 80)}"
    else if vm.service == "dav-server" then
      "http://${vm.ip}:${toString vm.davServer.httpPort}"
    else
      null;

  routesForVm = name: vm:
    let
      vmExposure = exposure.vms.${name} or { };
      serviceBackend = serviceBackendFor vm;
      serviceRoute = lib.optional (
        (vmExposure.service.enable or false) && serviceBackend != null
      ) {
        name = "service";
        enable = true;
        path = "/";
        backend = serviceBackend;
        access = vmExposure.service.access or "wireguard";
      };
      nixpiRoute = lib.optional (vmExposure.nixpi.enable or false) {
        name = "nixpi";
        enable = true;
        path = vmExposure.nixpi.path or "/nixpi/";
        backend = "http://${vm.ip}:${toString (vm.nixpi.port or 4815)}";
        access = vmExposure.nixpi.access or "wireguard";
        stripPrefix = true;
      };
      subagentRoute = lib.optional (vmExposure.subagent.enable or false) {
        name = "subagent";
        enable = true;
        path = vmExposure.subagent.path or "/subagent/";
        backend = "http://${vm.ip}:${toString vmExposure.subagent.port}";
        access = vmExposure.subagent.access or "wireguard";
        stripPrefix = true;
      };
    in
    serviceRoute ++ nixpiRoute ++ subagentRoute;

  mkVhost = {
    domain,
    addr,
    routes,
  }: {
    serverName = domain;
    listen = [
      {
        inherit addr;
        port = 80;
      }
    ];
    locations = mkLocations routes;
  };

  mkDomainVhosts = domain: routes:
    let
      wireguardRoutes = lib.filter routeOnWireguard routes;
      publicRoutes = lib.filter (route: isRouted route && isPublic route) routes;
    in
    (lib.optional (wireguardRoutes != [ ]) {
      name = "${domain}-wireguard";
      value = mkVhost {
        inherit domain;
        addr = wireguardIp;
        routes = wireguardRoutes;
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

  directNixpiRoutes = lib.concatMap (
    name:
    let
      vm = fleet.vms.${name};
      vmExposure = exposure.vms.${name} or { };
      route = {
        name = "nixpi-direct";
        enable = vmExposure.nixpi.enable or false;
        path = "/";
        backend = "http://${vm.ip}:${toString (vm.nixpi.port or 4815)}";
        access = vmExposure.nixpi.access or "wireguard";
      };
    in
    mkDomainVhosts vm.nixpi.dns [ route ]
  ) (lib.attrNames fleet.vms);

  hostNixpiRoute = {
    name = "host-nixpi";
    enable = exposure.host.nixpi.enable or false;
    path = "/";
    backend = "http://127.0.0.1:${toString (exposure.host.nixpi.port or 4815)}";
    access = exposure.host.nixpi.access or "wireguard";
  };

  allRouteLists =
    [ [ hostNixpiRoute ] ]
    ++ (map (name: routesForVm name fleet.vms.${name}) (lib.attrNames fleet.vms));
  publicHttpEnabled = lib.any (routes: lib.any (route: isRouted route && isPublic route) routes) allRouteLists;
in
{
  services.nginx = {
    enable = true;
    recommendedGzipSettings = true;
    recommendedOptimisation = true;
    recommendedProxySettings = true;

    virtualHosts = lib.listToAttrs (
      vmDomainVhosts
      ++ directNixpiRoutes
      ++ (mkDomainVhosts exposure.host.nixpi.domain [ hostNixpiRoute ])
    );
  };

  systemd.services.nginx = {
    after = [
      "wireguard-wg0.service"
      "nixpi.service"
    ] ++ microvmUnits;
    wants = [ "wireguard-wg0.service" ];
  };

  systemd.services.git-ssh-proxy = {
    description = "Private Forgejo Git SSH proxy to the git MicroVM";
    after = [
      "network-online.target"
      "wireguard-wg0.service"
      "microvm@git.service"
    ];
    wants = [
      "network-online.target"
      "wireguard-wg0.service"
      "microvm@git.service"
    ];
    wantedBy = [ "multi-user.target" ];
    path = [ pkgs.socat ];
    serviceConfig = {
      ExecStart = "${pkgs.socat}/bin/socat TCP-LISTEN:${toString git.sshPort},bind=${wireguardIp},reuseaddr,fork TCP:${git.ip}:${toString git.sshPort}";
      Restart = "always";
      RestartSec = "5s";
    };
  };

  networking.firewall.allowedTCPPorts = lib.mkIf publicHttpEnabled [ 80 ];
  networking.firewall.interfaces.wg0.allowedTCPPorts = [
    80
    git.sshPort
  ];
}
