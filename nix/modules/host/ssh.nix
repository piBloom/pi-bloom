{ lib, ... }:
{
  services.openssh = {
    enable = true;
    authorizedKeysFiles = lib.mkForce [ "/etc/ssh/authorized_keys.d/%u" ];
    # Canonical private access uses sshuttle over this hardened public SSH
    # endpoint. SSH remains alex-only and key-only; root SSH is disabled.
    # Firewall opening is interface-scoped below so MicroVM tap links never get
    # host SSH access.
    openFirewall = false;
    settings = {
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
      PermitRootLogin = "no";
      AllowUsers = [ "alex" ];
      X11Forwarding = false;
    };
  };

  networking.firewall.interfaces.enp0s31f6.allowedTCPPorts = [ 22 ];
}
