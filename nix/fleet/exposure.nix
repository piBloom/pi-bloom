{
  # Declarative HTTP exposure policy for host nginx.
  #
  # access = "wireguard" keeps the route on 10.44.0.1 only.
  # access = "public" additionally exposes the route on the host public IPv4
  # and opens TCP/80. Only use after an explicit hardening review.

  host = {
    nixpi = {
      enable = true;
      domain = "nixpi.nazar.studio";
      port = 4815;
      access = "wireguard";
    };
  };

  vms = {
    git = {
      service = {
        enable = true;
        access = "wireguard";
      };
      nixpi = {
        enable = true;
        path = "/nixpi/";
        access = "wireguard";
      };
      subagent = {
        enable = false;
        path = "/subagent/";
        port = 4815;
        access = "wireguard";
      };
    };

    minecraft = {
      service.enable = false;
      nixpi = {
        enable = true;
        path = "/nixpi/";
        access = "wireguard";
      };
      subagent = {
        enable = false;
        path = "/subagent/";
        port = 4815;
        access = "wireguard";
      };
    };

    ownloom = {
      service = {
        enable = true;
        access = "wireguard";
      };
      nixpi = {
        enable = true;
        path = "/nixpi/";
        access = "wireguard";
      };
      subagent = {
        enable = false;
        path = "/subagent/";
        port = 4815;
        access = "wireguard";
      };
    };

    dav-server = {
      service = {
        enable = true;
        access = "wireguard";
      };
      nixpi = {
        enable = true;
        path = "/nixpi/";
        access = "wireguard";
      };
      subagent = {
        enable = false;
        path = "/subagent/";
        port = 4815;
        access = "wireguard";
      };
    };
  };
}
