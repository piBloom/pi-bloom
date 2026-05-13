{
  networking.wireguard.useNetworkd = false;

  # Keep the host itself aligned with the WireGuard-private DNS view so local
  # deploy/push commands use the private proxies instead of public DNS.
  networking.hosts."10.44.0.1" = [
    "git.nazar.studio"
    "dav.nazar.studio"
    "ownloom.nazar.studio"
    "nixpi.nazar.studio"
    "nixpi-git.nazar.studio"
    "nixpi-minecraft.nazar.studio"
    "nixpi-ownloom.nazar.studio"
    "nixpi-dav-server.nazar.studio"
  ];

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
      address = [
        "/git.nazar.studio/10.44.0.1"
        "/dav.nazar.studio/10.44.0.1"
        "/ownloom.nazar.studio/10.44.0.1"
        "/nixpi.nazar.studio/10.44.0.1"
        "/nixpi-git.nazar.studio/10.44.0.1"
        "/nixpi-minecraft.nazar.studio/10.44.0.1"
        "/nixpi-ownloom.nazar.studio/10.44.0.1"
        "/nixpi-dav-server.nazar.studio/10.44.0.1"
      ];
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
