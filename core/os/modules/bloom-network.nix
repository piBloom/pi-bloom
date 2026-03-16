# core/os/modules/bloom-network.nix
{ pkgs, lib, config, ... }:

{
  options.bloom.wifi = {
    ssid = lib.mkOption { type = lib.types.str; default = ""; description = "WiFi SSID (empty = disabled)"; };
    psk  = lib.mkOption { type = lib.types.str; default = ""; description = "WiFi PSK"; };
  };

  config = {
    services.netbird.enable = true;

    services.openssh = {
      enable = true;
      settings = {
        PasswordAuthentication = true;
        PubkeyAuthentication = "no";
        PermitRootLogin = "no";
      };
    };

    networking.firewall.trustedInterfaces = [ "wt0" ];
    networking.networkmanager.enable = true;

    # TODO: PSK is stored in the Nix store in plaintext when set. Use sops-nix or
    # agenix for production deployments. WiFi is disabled by default (ssid = "").
    environment.etc."NetworkManager/system-connections/wifi.nmconnection" =
      lib.mkIf (config.bloom.wifi.ssid != "") {
        mode = "0600";
        text = ''
          [connection]
          id=${config.bloom.wifi.ssid}
          type=wifi
          autoconnect=true

          [wifi]
          mode=infrastructure
          ssid=${config.bloom.wifi.ssid}

          [wifi-security]
          key-mgmt=wpa-psk
          psk=${config.bloom.wifi.psk}

          [ipv4]
          method=auto

          [ipv6]
          method=auto
        '';
      };

    environment.systemPackages = with pkgs; [
      git git-lfs gh
      ripgrep fd bat htop jq curl wget unzip openssl
      just shellcheck biome typescript
      podman buildah skopeo oras
      qemu OVMF
      vscode chromium
      netbird
    ];
  };
}
