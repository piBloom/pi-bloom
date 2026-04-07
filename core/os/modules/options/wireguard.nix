{ lib, ... }:

let
  mkPeerOption =
    description:
    lib.mkOption {
      type = lib.types.str;
      inherit description;
    };
in
{
  options.nixpi.wireguard = {
    enable = lib.mkEnableOption "native WireGuard hub interface for NixPI" // {
      default = true;
    };

    interface = lib.mkOption {
      type = lib.types.str;
      default = "wg0";
      description = ''
        WireGuard interface name used as the trusted remote-access boundary.
      '';
    };

    address = lib.mkOption {
      type = lib.types.str;
      default = "10.77.0.1/24";
      description = ''
        CIDR address assigned to the NixPI WireGuard interface.
      '';
    };

    listenPort = lib.mkOption {
      type = lib.types.port;
      default = 51820;
      description = ''
        UDP listen port for the NixPI WireGuard hub.
      '';
    };

    privateKeyFile = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/nixpi/wireguard/private.key";
      description = ''
        Runtime path to the WireGuard private key for the NixPI hub.
      '';
    };

    generatePrivateKeyFile = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether NixOS should generate the WireGuard private key file
        automatically when it does not already exist.
      '';
    };

    peers = lib.mkOption {
      default = [ ];
      description = ''
        Remote WireGuard peers allowed to reach the NixPI host.
      '';
      type =
        with lib.types;
        listOf (submodule {
          options = {
            name = lib.mkOption {
              type = lib.types.str;
              default = "";
              description = ''
                Optional human-readable name for the peer.
              '';
            };

            publicKey = mkPeerOption ''
              Base64 public key of the remote WireGuard peer.
            '';

            allowedIPs = lib.mkOption {
              type = with lib.types; listOf str;
              default = [ ];
              description = ''
                CIDR ranges routed to this peer and accepted from it.
              '';
            };

            endpoint = lib.mkOption {
              type = with lib.types; nullOr str;
              default = null;
              description = ''
                Optional peer endpoint in host:port form. Usually left unset for
                roaming clients that dial in to the NixPI hub.
              '';
            };

            presharedKeyFile = lib.mkOption {
              type = with lib.types; nullOr str;
              default = null;
              description = ''
                Optional runtime path to a WireGuard preshared key file.
              '';
            };

            persistentKeepalive = lib.mkOption {
              type = with lib.types; nullOr ints.unsigned;
              default = null;
              description = ''
                Optional keepalive interval for peers that sit behind NAT.
              '';
            };

            dynamicEndpointRefreshSeconds = lib.mkOption {
              type = with lib.types; nullOr ints.unsigned;
              default = null;
              description = ''
                Optional hostname refresh interval for peers that use a DNS endpoint.
              '';
            };
          };
        });
    };
  };
}
