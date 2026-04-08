{
  pkgs,
  lib,
  config,
  ...
}:

let
  cfg = config.nixpi.services;
  wgCfg = config.nixpi.wireguard;
  tlsDir = "/var/lib/nixpi-tls";
  tlsCertPath = "${tlsDir}/nixpi-secure.crt";
  tlsKeyPath = "${tlsDir}/nixpi-secure.key";
  wireguardIp = if wgCfg.enable then builtins.head (lib.splitString "/" wgCfg.address) else "";
  terminalProxyExtraConfig = ''
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  '';
  terminalProxyLocation = {
    proxyPass = "http://127.0.0.1:7681/";
    extraConfig = terminalProxyExtraConfig;
  };
  secureWebTlsSetup = pkgs.writeShellScript "nixpi-secure-web-tls-setup" ''
        set -euo pipefail

        tls_dir="${tlsDir}"
        cert_path="${tlsCertPath}"
        key_path="${tlsKeyPath}"
        host_name="${config.networking.hostName}"
        wireguard_ip="${wireguardIp}"

        fqdn=""
        common_name="$host_name"
        if [ -n "$fqdn" ]; then
          common_name="$fqdn"
        fi

        san_entries="DNS:$host_name,DNS:localhost,IP:127.0.0.1"
        if [ -n "$fqdn" ]; then
          san_entries="$san_entries,DNS:$fqdn"
        fi
        if [ -n "$wireguard_ip" ]; then
          san_entries="$san_entries,IP:$wireguard_ip"
        fi

        install -d -m 0750 -o nginx -g nginx "$tls_dir"
        tmp_conf="$(mktemp)"
        cat > "$tmp_conf" <<EOF
    [req]
    distinguished_name = dn
    x509_extensions = v3_req
    prompt = no

    [dn]
    CN = $common_name

    [v3_req]
    subjectAltName = $san_entries
    basicConstraints = CA:FALSE
    keyUsage = digitalSignature, keyEncipherment
    extendedKeyUsage = serverAuth
    EOF

        ${pkgs.openssl}/bin/openssl req \
          -x509 \
          -nodes \
          -newkey rsa:2048 \
          -days 3650 \
          -keyout "$key_path" \
          -out "$cert_path" \
          -config "$tmp_conf"

        rm -f "$tmp_conf"
        chown nginx:nginx "$cert_path" "$key_path"
        chmod 0640 "$cert_path" "$key_path"
  '';
in
{
  imports = [ ./options.nix ];

  config = {
    assertions = [
      {
        assertion = (!cfg.home.enable) || cfg.secureWeb.enable;
        message = "Canonical hosted access requires nixpi.services.secureWeb.enable = true.";
      }
    ];

    systemd.tmpfiles.settings = lib.mkIf cfg.secureWeb.enable {
      nixpi-tls."${tlsDir}".d = {
        mode = "0750";
        user = "nginx";
        group = "nginx";
      };
    };

    systemd.services.nixpi-secure-web-tls = lib.mkIf cfg.secureWeb.enable {
      description = "Generate self-signed TLS certificate for secure NixPI web entry point";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      before = [ "nginx.service" ];
      serviceConfig = {
        Type = "oneshot";
        User = "root";
        Group = "root";
        ExecStart = secureWebTlsSetup;
      };
    };

    services.nginx = lib.mkMerge [
      (lib.mkIf cfg.home.enable {
        enable = true;
        recommendedProxySettings = true;
        virtualHosts.nixpi-home = {
          default = true;
          listen = [
            {
              addr = cfg.bindAddress;
              port = 80;
            }
          ];
          locations."/terminal" = terminalProxyLocation;
          locations."/" = {
            proxyPass = terminalProxyLocation.proxyPass;
            extraConfig = terminalProxyExtraConfig + lib.optionalString cfg.secureWeb.enable ''
              if ($host !~* ^(localhost|127\.0\.0\.1)$) {
                return 308 https://$host$request_uri;
              }
            '';
          };
        };
      })
      (lib.mkIf cfg.secureWeb.enable {
        enable = true;
        recommendedProxySettings = true;
        virtualHosts.nixpi-secure-web = {
          default = true;
          onlySSL = true;
          listen = [
            {
              addr = cfg.bindAddress;
              port = cfg.secureWeb.port;
              ssl = true;
            }
          ];
          sslCertificate = tlsCertPath;
          sslCertificateKey = tlsKeyPath;
          locations."/terminal" = terminalProxyLocation;
          locations."/" = terminalProxyLocation;
        };
      })
    ];
  };
}
