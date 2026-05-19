{ ... }:

{
  imports = [
    ../../modules/common.nix
    ../../modules/proxmox-vm.nix
  ];

  networking.hostName = "headscale";

  networking.interfaces.ens18.ipv4.addresses = [
    {
      address = "10.10.10.11";
      prefixLength = 24;
    }
  ];

  networking.defaultGateway = "10.10.10.1";
  networking.nameservers = [
    "1.1.1.1"
    "9.9.9.9"
  ];

  networking.firewall = {
    enable = true;
    allowedTCPPorts = [
      22
      8080
    ];
  };

  services.headscale = {
    enable = true;
    address = "0.0.0.0";
    port = 8080;

    settings = {
      server_url = "https://headscale.nazar.studio";

      database = {
        type = "sqlite";
        sqlite = {
          path = "/var/lib/headscale/db.sqlite";
          write_ahead_log = true;
        };
      };

      dns = {
        magic_dns = true;
        base_domain = "tailnet.nazar.studio";
        override_local_dns = false;
        nameservers.global = [
          "1.1.1.1"
          "9.9.9.9"
        ];
        extra_records = [
          {
            name = "proxmox.tailnet.nazar.studio";
            type = "A";
            value = "10.10.10.1";
          }
          {
            name = "proxmox.nazar.studio";
            type = "A";
            value = "10.10.10.1";
          }
          {
            name = "edge.tailnet.nazar.studio";
            type = "A";
            value = "10.10.10.10";
          }
          {
            name = "headscale.tailnet.nazar.studio";
            type = "A";
            value = "10.10.10.11";
          }
        ];
      };

      prefixes = {
        v4 = "100.64.0.0/10";
        v6 = "fd7a:115c:a1e0::/48";
        allocation = "sequential";
      };

      log = {
        level = "info";
        format = "text";
      };

      derp = {
        urls = [ "https://controlplane.tailscale.com/derpmap/default" ];
        auto_update_enabled = true;
        update_frequency = "24h";
      };
    };
  };

  system.stateVersion = "25.11";
}
