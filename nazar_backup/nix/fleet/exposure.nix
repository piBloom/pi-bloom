{
  # Declarative local service ports. Operator browser access is via SSH local
  # forwarding from the laptop to these host loopback ports.

  host = {
    hermesDashboard = {
      enable = true;
      port = 9119;
    };
  };
}
