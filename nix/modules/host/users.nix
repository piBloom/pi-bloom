{ ... }:
let
  alexPublicSshKeys = import ../../users/alex-public-ssh-keys.nix;
  hostIdentity = import ../../fleet/host.nix;
in
{
  users.mutableUsers = false;

  users.users.root = {
    # Root SSH is disabled in nix/modules/host/ssh.nix. Recovery is through
    # Hetzner Rescue, not root login on the installed system.
    openssh.authorizedKeys.keys = [ ];
    hashedPassword = "!";
  };

  users.users.alex = {
    isNormalUser = true;
    description = "Daily Nazar administrator";
    extraGroups = [
      "wheel"
      "systemd-journal"
      "kvm"
    ];
    # Public OpenSSH is allowed only for alex, key-only, and only with the
    # deliberately small personal-device key set below.
    openssh.authorizedKeys.keys = alexPublicSshKeys;
    hashedPassword = "!";
  };

  security.sudo.wheelNeedsPassword = false;

  systemd.tmpfiles.rules = [
    "d /persist 0755 root root - -"
    "d /persist/secrets 0700 root root - -"
    "d /home/alex/repos 0755 alex users - -"
    "d ${hostIdentity.repository.localPath} 0755 alex users - -"
    "d /var/lib/nazar 0750 root root - -"
  ];

}
