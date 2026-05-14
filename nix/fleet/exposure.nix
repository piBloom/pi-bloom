{
  # Declarative HTTP exposure policy for host nginx.
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
    };
  };

  vms = {
    git = {
      service = {
        enable = true;
        access = "private";
      };
    };

    minecraft = {
      service.enable = false;
    };

    dav-server = {
      service = {
        enable = true;
        access = "private";
      };
    };
  };
}
