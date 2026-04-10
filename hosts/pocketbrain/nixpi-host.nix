{ ... }:
{
  networking.hostName = "pocketbrain";

  # Exit bootstrap flow, but keep remote admin access explicitly enabled.
  nixpi.bootstrap.enable = false;
  nixpi.bootstrap.ssh.enable = true;
  nixpi.bootstrap.temporaryAdmin.enable = false;

  nixpi.primaryUser = "alex";
  nixpi.timezone = "Europe/Bucharest";
  nixpi.keyboard = "us";

  nixpi.security.ssh.allowedSourceCIDRs = [
    "188.24.176.127/32"
  ];

  users.users.alex.openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG0j6qRWHj+WsYYrjJvZAXdc5ukYyb2wtE2Y+BVZd6SQ alex@fedora"
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB3MBZfaJf5tx+OCGzynhWCOBWIvx27gXIPse6gew0aQ"
  ];
}
