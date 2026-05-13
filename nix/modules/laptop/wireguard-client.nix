{ devices, pkgs, ... }:
let
  wg = devices.wireguard;
in
{
  networking.wireguard.interfaces.wg-nazar = {
    ips = [ wg.peers.alex-laptop.address ];
    privateKeyFile = "/etc/wireguard/nazar-laptop.key";

    peers = [
      {
        publicKey = wg.peers.nazar.publicKey;
        endpoint = wg.endpoint;
        allowedIPs = [ wg.network ];
        persistentKeepalive = 25;
      }
    ];

    postSetup = ''
      printf 'search nazar.studio\nnameserver ${wg.dns}\n' \
        | ${pkgs.openresolv}/bin/resolvconf -a wg-nazar -x -m 0
      ${pkgs.openresolv}/bin/resolvconf -u
    '';

    postShutdown = ''
      ${pkgs.openresolv}/bin/resolvconf -d wg-nazar || true
      ${pkgs.openresolv}/bin/resolvconf -u || true
    '';
  };
}
