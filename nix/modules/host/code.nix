{ lib, pkgs, ... }:
let
  exposure = import ../../fleet/exposure.nix;
  hostCode = exposure.host.code or { };
  pi = pkgs.callPackage ../../packages/pi { };
in
{
  # Native NixOS OpenVSCode Server: no container, no ad-hoc npm install.
  # It runs as alex so browser terminals/editors see the same repos and home
  # state as SSH/NixPi sessions.
  services.openvscode-server = {
    enable = hostCode.enable or false;
    user = "alex";
    group = "users";
    host = "127.0.0.1";
    port = hostCode.port or 4821;

    # The nginx route is private-only in nix/fleet/exposure.nix. Keeping the
    # OpenVSCode connection token disabled makes mobile browser entry match
    # NixPi while the compile-time assertion below prevents accidental public
    # tokenless exposure.
    withoutConnectionToken = true;
    telemetryLevel = "off";

    userDataDir = "/home/alex/.openvscode-server/user-data";
    serverDataDir = "/home/alex/.openvscode-server/server-data";
    extensionsDir = "/home/alex/.openvscode-server/extensions";

    extraPackages = with pkgs; [
      bashInteractive
      coreutils
      curl
      fd
      gcc
      git
      gnumake
      gnugrep
      gnused
      gnutar
      gzip
      jq
      nil
      nix
      nixfmt-rfc-style
      nodejs
      openssh
      pi
      pkg-config
      python3
      ripgrep
      unzip
      wget
      xz
    ];

    extraEnvironment = {
      NIX_CONFIG = "experimental-features = nix-command flakes";
      NPM_CONFIG_PREFIX = "/home/alex/.pi/npm-global";
      NODE_PATH = "/home/alex/.pi/npm-global/lib/node_modules";
    };

    extraArguments = [ "/home/alex" ];
  };

  systemd.tmpfiles.rules = lib.mkIf (hostCode.enable or false) [
    "d /home/alex/.openvscode-server 0750 alex users - -"
    "d /home/alex/.openvscode-server/user-data 0750 alex users - -"
    "d /home/alex/.openvscode-server/server-data 0750 alex users - -"
    "d /home/alex/.openvscode-server/extensions 0750 alex users - -"
  ];

  assertions = [
    {
      assertion = !(hostCode.enable or false) || (hostCode.access or "private") != "public";
      message = "code.nazar.studio runs OpenVSCode tokenless as alex; keep exposure.host.code.access private or add a separate auth/token design first.";
    }
  ];
}
