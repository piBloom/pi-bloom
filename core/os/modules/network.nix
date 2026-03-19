# core/os/modules/network.nix
{ pkgs, lib, config, ... }:

let
  u = config.nixpi.username;
  bloomHomeBootstrap = pkgs.writeShellScript "nixpi-home-bootstrap" ''
    set -eu
    mkdir -p "$HOME/.config/workspace/home" "$HOME/.config/workspace/home/tmp"
    if [ ! -f "$HOME/.config/workspace/home/index.html" ]; then
      cat > "$HOME/.config/workspace/home/index.html" <<'HTML'
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspace Home</title></head>
<body>
  <h1>Workspace Home</h1>
  <ul>
    <li><a href="http://localhost:8081">Workspace Web Chat</a></li>
    <li><a href="http://localhost:5000">Workspace Files</a></li>
    <li><a href="http://localhost:8443">code-server</a></li>
  </ul>
</body>
</html>
HTML
    fi
    cat > "$HOME/.config/workspace/home/nginx.conf" <<'NGINX'
daemon off;
pid /run/user/1000/nixpi-home-nginx.pid;
error_log stderr;
events { worker_connections 64; }
http {
    include ${pkgs.nginx}/conf/mime.types;
    default_type application/octet-stream;
    access_log off;
    client_body_temp_path /home/${u}/.config/workspace/home/tmp;
    server {
        listen 8080;
        root /home/${u}/.config/workspace/home;
        try_files $uri $uri/ =404;
    }
}
NGINX
  '';
  fluffychatBootstrap = pkgs.writeShellScript "nixpi-chat-bootstrap" ''
    set -eu
    mkdir -p "$HOME/.config/workspace/fluffychat" "$HOME/.config/workspace/fluffychat/tmp"
    cat > "$HOME/.config/workspace/fluffychat/config.json" <<'CONFIG'
{
  "applicationName": "Workspace Web Chat",
  "defaultHomeserver": "http://localhost:6167"
}
CONFIG
    cat > "$HOME/.config/workspace/fluffychat/nginx.conf" <<'NGINX'
daemon off;
pid /run/user/1000/nixpi-chat-nginx.pid;
error_log stderr;
events { worker_connections 64; }
http {
    include ${pkgs.nginx}/conf/mime.types;
    default_type application/octet-stream;
    access_log off;
    client_body_temp_path /home/${u}/.config/workspace/fluffychat/tmp;
    server {
        listen 8081;
        location /config.json {
            alias /home/${u}/.config/workspace/fluffychat/config.json;
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

    networking.firewall.trustedInterfaces = [ "wt0" ];
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
        ExecStartPre = "${bloomHomeBootstrap}";
        ExecStart = "${pkgs.nginx}/bin/nginx -c %h/.config/workspace/home/nginx.conf";
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
        ExecStart = "${pkgs.nginx}/bin/nginx -c %h/.config/workspace/fluffychat/nginx.conf";
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
        ExecStartPre = "${pkgs.coreutils}/bin/mkdir -p %h/Public/Workspace";
        ExecStart = "${pkgs.dufs}/bin/dufs %h/Public/Workspace -A -b 0.0.0.0 -p 5000";
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
      "d /home/${u}/.config/workspace 0755 ${u} ${u} -"
      "d /home/${u}/.config/workspace/home 0755 ${u} ${u} -"
      "d /home/${u}/.config/workspace/fluffychat 0755 ${u} ${u} -"
      "d /home/${u}/.config/code-server 0755 ${u} ${u} -"
      "d /home/${u}/Public/Workspace 0755 ${u} ${u} -"
    ];

    system.activationScripts.nixpi-builtins = lib.stringAfter [ "users" ] ''
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/workspace/home
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/workspace/home/tmp
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/workspace/fluffychat
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/workspace/fluffychat/tmp
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/code-server
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/Public/Workspace

      cat > /home/${u}/.config/workspace/home/index.html <<'HTML'
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspace Home</title></head>
<body>
  <h1>Workspace Home</h1>
  <ul>
    <li><a href="http://localhost:8081">Workspace Web Chat</a></li>
    <li><a href="http://localhost:5000">Workspace Files</a></li>
    <li><a href="http://localhost:8443">Workspace Code</a></li>
  </ul>
</body>
</html>
HTML

      cat > /home/${u}/.config/workspace/home/nginx.conf <<'NGINX'
daemon off;
pid /run/user/1000/nixpi-home-nginx.pid;
error_log stderr;
events { worker_connections 64; }
http {
    include ${pkgs.nginx}/conf/mime.types;
    default_type application/octet-stream;
    access_log off;
    client_body_temp_path /home/${u}/.config/workspace/home/tmp;
    server {
        listen 8080;
        root /home/${u}/.config/workspace/home;
        try_files $uri $uri/ =404;
    }
}
NGINX

      cat > /home/${u}/.config/workspace/fluffychat/config.json <<'CONFIG'
{
  "applicationName": "Workspace Web Chat",
  "defaultHomeserver": "http://localhost:6167"
}
CONFIG

      cat > /home/${u}/.config/workspace/fluffychat/nginx.conf <<'NGINX'
daemon off;
pid /run/user/1000/nixpi-chat-nginx.pid;
error_log stderr;
events { worker_connections 64; }
http {
    include ${pkgs.nginx}/conf/mime.types;
    default_type application/octet-stream;
    access_log off;
    client_body_temp_path /home/${u}/.config/workspace/fluffychat/tmp;
    server {
        listen 8081;
        location /config.json {
            alias /home/${u}/.config/workspace/fluffychat/config.json;
        }
        location / {
            root /etc/nixpi/fluffychat-web;
            try_files $uri $uri/ /index.html;
        }
    }
}
NGINX

      chown -R ${u}:${u} /home/${u}/.config/workspace /home/${u}/.config/code-server /home/${u}/Public/Workspace
    '';
  };
}
