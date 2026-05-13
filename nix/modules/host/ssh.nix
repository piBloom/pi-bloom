{ lib, ... }:
{
  services.openssh = {
    enable = true;
    authorizedKeysFiles = lib.mkForce [ "/etc/ssh/authorized_keys.d/%u" ];
    # Canonical daily access is WireGuard first. Public OpenSSH remains only as
    # an alex-only, key-only break-glass path using the deliberately small
    # personal-device key set in nix/users/alex-public-ssh-keys.nix.
    # Root SSH is disabled; Hetzner Rescue is the final root/break-glass path.
    openFirewall = true;
    settings = {
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
      PermitRootLogin = "no";
      AllowUsers = [ "alex" ];
      X11Forwarding = false;
    };
  };

  networking.firewall.allowedTCPPorts = [ 22 ];
}
