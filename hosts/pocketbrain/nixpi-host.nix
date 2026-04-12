{ ... }:
{
  networking.hostName = "pocketbrain";

  # Exit bootstrap flow and keep sshd only for trusted-interface access.
  nixpi.bootstrap.enable = false;
  nixpi.bootstrap.ssh.enable = false;
  nixpi.bootstrap.temporaryAdmin.enable = false;

  nixpi.primaryUser = "alex";
  nixpi.timezone = "Europe/Bucharest";
  nixpi.keyboard = "us";

  nixpi.integrations.exa.enable = true;
  nixpi.integrations.exa.envFile = "/var/lib/nixpi/secrets/exa.env";

  services.openssh.enable = true;
  networking.firewall.allowedUDPPorts = [ 51820 ];
  networking.firewall.interfaces.wg0.allowedTCPPorts = [ 22 ];

  users.users.alex.openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG0j6qRWHj+WsYYrjJvZAXdc5ukYyb2wtE2Y+BVZd6SQ alex@fedora"
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB3MBZfaJf5tx+OCGzynhWCOBWIvx27gXIPse6gew0aQ"
  ];
}
