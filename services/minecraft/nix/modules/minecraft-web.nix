{
  lib,
  pkgs,
  vm,
  ...
}:
let
  webRoot = pkgs.stdenvNoCC.mkDerivation {
    pname = "nazar-minecraft-web";
    version = "1.0.0";
    src = ../../web;
    dontBuild = true;
    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -r . $out/
      runHook postInstall
    '';
  };
in
{
  networking.firewall.allowedTCPPorts = [ 80 ];

  services.nginx = {
    enable = true;
    recommendedGzipSettings = true;
    recommendedOptimisation = true;
    recommendedProxySettings = true;
    recommendedTlsSettings = true;

    virtualHosts.${vm.dns} = {
      root = webRoot;
      locations."/" = {
        index = "index.html";
        tryFiles = "$uri $uri/ /index.html";
      };
      extraConfig = ''
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
      '';
    };
  };

  assertions = [
    {
      assertion = vm ? dns && vm.dns != "";
      message = "The Minecraft web module requires vm.dns for the nginx virtual host.";
    }
  ];
}
