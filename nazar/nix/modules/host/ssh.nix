{ lib, ... }:
let
  hostIdentity = import ../../fleet/host.nix;
in
{
  services.openssh = {
    enable = true;
    authorizedKeysFiles = lib.mkForce [ "/etc/ssh/authorized_keys.d/%u" ];
    # Canonical operator access uses this hardened public SSH endpoint with
    # local port forwards for browser services.
    openFirewall = false;
    settings = {
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
      PermitRootLogin = "no";
      AllowUsers = [ "alex" ];
      X11Forwarding = false;
      AllowTcpForwarding = "local";
      GatewayPorts = "no";
    };
    extraConfig = ''
      PermitOpen 127.0.0.1:9119
    '';
  };

  networking.firewall.interfaces."${hostIdentity.public.nicName}".allowedTCPPorts = [ 22 ];
}
