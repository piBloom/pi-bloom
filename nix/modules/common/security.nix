{ lib, ... }:
{
  services.openssh = {
    enable = true;
    # Accept only the declarative NixOS authorized_keys files. Do not accept
    # unmanaged per-home ~/.ssh/authorized_keys drift on fleet VMs.
    authorizedKeysFiles = lib.mkForce [ "/etc/ssh/authorized_keys.d/%u" ];
    settings = {
      # VM administration is key-only via `alex` from the host `nazar`
      # over private NAT aliases. Root SSH is kept key-only for break-glass and
      # current compatibility, not as the canonical human login.
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
      PermitRootLogin = "prohibit-password";
    };
  };

  networking.firewall = {
    enable = true;
    allowPing = true;
    allowedTCPPorts = [ 22 ];
  };
}
