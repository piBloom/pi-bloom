{
  pkgs,
  lib,
  mkTestFilesystems,
  nixPiModulesNoShell,
  mkManagedUserConfig,
  ...
}:

let
  tlsCert = pkgs.runCommand "selfSignedCerts" { buildInputs = [ pkgs.openssl ]; } ''
    openssl req \
      -x509 -newkey rsa:4096 -sha256 -days 365 \
      -nodes -out cert.pem -keyout key.pem \
      -subj '/CN=headscale' -addext "subjectAltName=DNS:headscale"

    mkdir -p "$out"
    cp key.pem cert.pem "$out"
  '';

  peerNode =
    {
      hostName,
    }:
    {
      imports = [ mkTestFilesystems ];

      networking.hostName = hostName;
      services.openssh = {
        enable = true;
        openFirewall = true;
      };
      services.tailscale.enable = true;
      security.pki.certificateFiles = [ "${tlsCert}/cert.pem" ];

      environment.systemPackages = with pkgs; [
        jq
        netcat
        tailscale
      ];
    };
in
{
  name = "nixpi-headscale";

  nodes = {
    headscale =
      { config, ... }:
      {
        imports = nixPiModulesNoShell ++ [
          mkTestFilesystems
          (mkManagedUserConfig { username = "pi"; })
        ];

        networking.hostName = "headscale";

        nixpi.headscale = {
          enable = true;
          serverUrl = "https://headscale";
          settings = {
            derp = {
              server = {
                enabled = true;
                region_id = 999;
                stun_listen_addr = "0.0.0.0:3478";
              };
              urls = [ ];
            };
            dns = {
              base_domain = "tailnet";
              override_local_dns = false;
            };
          };
        };

        services.nginx = {
          enable = true;
          virtualHosts.headscale = {
            addSSL = true;
            sslCertificate = "${tlsCert}/cert.pem";
            sslCertificateKey = "${tlsCert}/key.pem";
            locations."/" = {
              proxyPass = "http://127.0.0.1:${toString config.services.headscale.port}";
              proxyWebsockets = true;
            };
          };
        };

        networking.firewall.allowedTCPPorts = [
          80
          443
        ];
        networking.firewall.allowedUDPPorts = [ 3478 ];

        environment.systemPackages = with pkgs; [
          jq
        ];
      };

    peer1 = peerNode { hostName = "peer1"; };
    peer2 = peerNode { hostName = "peer2"; };
  };

  testScript = ''
    start_all()

    headscale.wait_for_unit("headscale.service", timeout=120)
    headscale.wait_for_unit("nginx.service", timeout=120)
    headscale.wait_for_open_port(443)

    peer1.wait_for_unit("tailscaled.service", timeout=120)
    peer2.wait_for_unit("tailscaled.service", timeout=120)
    peer2.wait_for_unit("sshd.service", timeout=120)

    headscale.succeed("headscale users create test")
    auth_key = headscale.succeed("headscale preauthkeys -u 1 create --reusable").strip()

    up_cmd = f"tailscale up --login-server https://headscale --auth-key {auth_key} --accept-dns=false"
    peer1.succeed(up_cmd)
    peer2.succeed(up_cmd)

    peer1.wait_until_succeeds("tailscale ping peer2", timeout=120)
    peer2.wait_until_succeeds("tailscale ping peer1", timeout=120)
    headscale.wait_until_succeeds("headscale nodes list -o json | jq -e 'length == 2'", timeout=120)

    peer2_ip = peer2.succeed("tailscale ip -4").strip()
    peer1.succeed(f"nc -z -w 2 {peer2_ip} 22")

    print("NixPI Headscale access test passed!")
  '';
}
