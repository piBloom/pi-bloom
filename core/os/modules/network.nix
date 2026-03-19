# core/os/modules/network.nix
{ pkgs, lib, config, ... }:

let
  u = config.nixpi.username;
  nixpiHomeBootstrap = pkgs.writeShellScript "nixpi-home-bootstrap" ''
    set -eu
    mkdir -p "$HOME/.config/nixpi/home" "$HOME/.config/nixpi/home/tmp"
    if [ ! -f "$HOME/.config/nixpi/home/index.html" ]; then
      cat > "$HOME/.config/nixpi/home/index.html" <<'HTML'
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>nixPI Home</title></head>
<body>
  <h1>nixPI Home</h1>
  <ul>
    <li><a href="http://localhost:8081">nixPI Chat</a></li>
    <li><a href="http://localhost:5000">nixPI Files</a></li>
    <li><a href="http://localhost:8443">code-server</a></li>
  </ul>
</body>
</html>
HTML
    fi
    cat > "$HOME/.config/nixpi/home/nginx.conf" <<'NGINX'
daemon off;
pid /run/user/1000/nixpi-home-nginx.pid;
error_log stderr;
events { worker_connections 64; }
http {
    include ${pkgs.nginx}/conf/mime.types;
    default_type application/octet-stream;
    access_log off;
    client_body_temp_path /home/${u}/.config/nixpi/home/tmp;
    server {
        listen 8080;
        root /home/${u}/.config/nixpi/home;
        try_files $uri $uri/ =404;
    }
}
NGINX
  '';
  fluffychatBootstrap = pkgs.writeShellScript "nixpi-chat-bootstrap" ''
    set -eu
    mkdir -p "$HOME/.config/nixpi/chat" "$HOME/.config/nixpi/chat/tmp"
    cat > "$HOME/.config/nixpi/chat/config.json" <<'CONFIG'
{
  "applicationName": "nixPI Chat",
  "defaultHomeserver": "http://localhost:6167"
}
CONFIG
    cat > "$HOME/.config/nixpi/chat/nginx.conf" <<'NGINX'
daemon off;
pid /run/user/1000/nixpi-chat-nginx.pid;
error_log stderr;
events { worker_connections 64; }
http {
    include ${pkgs.nginx}/conf/mime.types;
    default_type application/octet-stream;
    access_log off;
    client_body_temp_path /home/${u}/.config/nixpi/chat/tmp;
    server {
        listen 8081;
        location /config.json {
            alias /home/${u}/.config/nixpi/chat/config.json;
        }
        location / {
            root /etc/nixpi/fluffychat-web;
            try_files $uri $uri/ /index.html;
        }
    }
}
NGINX
  '';
in

{
  config = {
    # Enable all firmware for maximum hardware compatibility.
    # This ensures WiFi, Bluetooth, and other hardware works out of the box
    # on the widest range of devices (Intel, Broadcom, Realtek, Atheros, etc.)
    hardware.enableAllFirmware = true;
    services.netbird.enable = true;

    services.openssh = {
      enable = true;
      settings = {
        PasswordAuthentication = true;
        PubkeyAuthentication = "yes";
        PermitRootLogin = "no";
      };
    };

    networking.firewall = {
      trustedInterfaces = [ "wt0" ];
      allowedTCPPorts = [ 22 6167 8080 8081 5000 8443 ];
    };
    networking.networkmanager.enable = true;

    environment.etc."nixpi/fluffychat-web".source = pkgs.fluffychat-web;

    environment.systemPackages = with pkgs; [
      git git-lfs gh
      ripgrep fd bat htop jq curl wget unzip openssl
      just shellcheck biome typescript
      qemu OVMF
      chromium
      netbird
      dufs nginx code-server
    ];

    systemd.user.services.nixpi-home = {
      description = "nixPI Home landing page";
      wantedBy = [ "default.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      serviceConfig = {
        ExecStartPre = "${nixpiHomeBootstrap}";
        ExecStart = "${pkgs.nginx}/bin/nginx -c %h/.config/nixpi/home/nginx.conf";
        Restart = "on-failure";
        RestartSec = 10;
      };
    };

    systemd.user.services.nixpi-chat = {
      description = "nixPI web chat client";
      wantedBy = [ "default.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      serviceConfig = {
        ExecStartPre = "${fluffychatBootstrap}";
        ExecStart = "${pkgs.nginx}/bin/nginx -c %h/.config/nixpi/chat/nginx.conf";
        Restart = "on-failure";
        RestartSec = 10;
      };
    };

    systemd.user.services.nixpi-files = {
      description = "nixPI Files WebDAV";
      wantedBy = [ "default.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      serviceConfig = {
        ExecStartPre = "${pkgs.coreutils}/bin/mkdir -p %h/Public/nixPI";
        ExecStart = "${pkgs.dufs}/bin/dufs %h/Public/nixPI -A -b 0.0.0.0 -p 5000";
        Restart = "on-failure";
        RestartSec = 10;
      };
    };

    systemd.user.services.nixpi-code = {
      description = "nixPI code-server";
      wantedBy = [ "default.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      serviceConfig = {
        ExecStart = "${pkgs.code-server}/bin/code-server --bind-addr 0.0.0.0:8443 --auth none --disable-telemetry";
        Restart = "on-failure";
        RestartSec = 10;
      };
    };

    systemd.tmpfiles.rules = [
      "d /home/${u}/.config 0755 ${u} ${u} -"
      "d /home/${u}/.config/systemd 0755 ${u} ${u} -"
      "d /home/${u}/.config/systemd/user 0755 ${u} ${u} -"
      "d /home/${u}/.config/nixpi 0755 ${u} ${u} -"
      "d /home/${u}/.config/nixpi/home 0755 ${u} ${u} -"
      "d /home/${u}/.config/nixpi/chat 0755 ${u} ${u} -"
      "d /home/${u}/.config/code-server 0755 ${u} ${u} -"
      "d /home/${u}/Public/nixPI 0755 ${u} ${u} -"
    ];

    system.activationScripts.nixpi-builtins = lib.stringAfter [ "users" ] ''
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/systemd
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/systemd/user
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/nixpi/home
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/nixpi/home/tmp
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/nixpi/chat
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/nixpi/chat/tmp
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/code-server
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/Public/nixPI

      cat > /home/${u}/.config/nixpi/home/index.html <<'HTML'
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>nixPI Home</title></head>
<body>
  <h1>nixPI Home</h1>
  <ul>
    <li><a href="http://localhost:8081">nixPI Chat</a></li>
    <li><a href="http://localhost:5000">nixPI Files</a></li>
    <li><a href="http://localhost:8443">nixPI Code</a></li>
  </ul>
</body>
</html>
HTML

      cat > /home/${u}/.config/nixpi/home/nginx.conf <<'NGINX'
daemon off;
pid /run/user/1000/nixpi-home-nginx.pid;
error_log stderr;
events { worker_connections 64; }
http {
    include ${pkgs.nginx}/conf/mime.types;
    default_type application/octet-stream;
    access_log off;
    client_body_temp_path /home/${u}/.config/nixpi/home/tmp;
    server {
        listen 8080;
        root /home/${u}/.config/nixpi/home;
        try_files $uri $uri/ =404;
    }
}
NGINX

      cat > /home/${u}/.config/nixpi/chat/config.json <<'CONFIG'
{
  "applicationName": "nixPI Chat",
  "defaultHomeserver": "http://localhost:6167"
}
CONFIG

      cat > /home/${u}/.config/nixpi/chat/nginx.conf <<'NGINX'
daemon off;
pid /run/user/1000/nixpi-chat-nginx.pid;
error_log stderr;
events { worker_connections 64; }
http {
    include ${pkgs.nginx}/conf/mime.types;
    default_type application/octet-stream;
    access_log off;
    client_body_temp_path /home/${u}/.config/nixpi/chat/tmp;
    server {
        listen 8081;
        location /config.json {
            alias /home/${u}/.config/nixpi/chat/config.json;
        }
        location / {
            root /etc/nixpi/fluffychat-web;
            try_files $uri $uri/ /index.html;
        }
    }
}
NGINX

      chown -R ${u}:${u} /home/${u}/.config /home/${u}/Public/nixPI
    '';
  };
}
