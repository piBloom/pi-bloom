{
  # Declarative HTTP exposure policy for host nginx.
  #
  # This file owns host HTTP exposure metadata and private hostnames. Host site,
  # NixPi, and Code routes are rendered by service-proxy.nix; DAV's nginx vhost
  # is rendered by host/dav-server.nix but its private hostname is kept here so
  # host/laptop private-domain generation has one source. VM private service
  # domains are derived from nix/fleet/vms.nix `privateAccess`.
  #
  # access = "private" serves the route only on the sshuttle-routed private
  # address, 10.44.0.1.
  # access = "public" additionally exposes the route on the host public IPv4
  # and opens TCP/80. Only use after an explicit hardening review.

  # Domains listed here stay out of generated private /etc/hosts entries.
  # Keep this empty so all private domains are routed through sshuttle.
  privateDomainExclusions = [ ];

  host = {
    site = {
      enable = true;
      domain = "nazar.studio";
      root = ../../www/nazar-dashboard;
      access = "public";
    };

    nixpi = {
      enable = true;
      domain = "nixpi.nazar.studio";
      port = 4815;
      access = "private";
      # Support browser access through SSH local forwards, where the browser
      # sends Host: 127.0.0.1:<local-port> or Host: localhost:<local-port>.
      localTunnelAliases = [
        "127.0.0.1"
        "localhost"
      ];
    };

    code = {
      enable = true;
      domain = "code.nazar.studio";
      port = 4821;
      access = "private";
    };

    dav = {
      enable = true;
      domain = "dav.nazar.studio";
      access = "private";
    };
  };
}
