{ ... }:
{
  networking.firewall = {
    enable = true;
    allowPing = true;
    checkReversePath = "loose";
  };

  boot.kernel.sysctl = {
    "net.ipv4.ip_forward" = false;
    "net.ipv6.conf.all.forwarding" = false;
  };
}
