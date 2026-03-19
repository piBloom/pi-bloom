# core/os/modules/matrix.nix
{ pkgs, config, ... }:

{
  services.matrix-synapse = {
    enable = true;
    
    settings = {
      server_name = config.networking.hostName;
      public_baseurl = "http://localhost:6167";
      
      listeners = [
        {
          port = 6167;
          bind_addresses = [ "0.0.0.0" ];
          type = "http";
          tls = false;
          x_forwarded = false;
          resources = [
            {
              names = [ "client" "federation" ];
              compress = true;
            }
          ];
        }
      ];
      
      # Use SQLite for simplicity (suitable for single-user/embedded use)
      database.name = "sqlite3";
      database.args = {
        database = "/var/lib/matrix-synapse/homeserver.db";
      };
      
      # Registration settings
      enable_registration = true;
      
      # Don't require email verification
      registrations_require_3pid = [];
      
      # Disable federation (private homeserver)
      federation_domain_whitelist = [];
      
      # Limit request size for file uploads
      max_upload_size = "20M";
      
      # Disable presence (reduces resource usage)
      use_presence = false;
      
      # URL preview settings
      url_preview_enabled = false;
    };
    
    # Extra configuration lines for registration shared secret
    extraConfigFiles = [];
  };

  # Override the systemd service to add bootstrap script and ensure proper ordering
  systemd.services.matrix-synapse = {
    serviceConfig = {
      # Ensure data directory exists with proper permissions
      StateDirectory = "matrix-synapse";
      StateDirectoryMode = "0750";
    };
    preStart = ''
      # Bootstrap registration shared secret if not exists
      TOKEN_FILE=/var/lib/matrix-synapse/registration_shared_secret
      if [ ! -f "$TOKEN_FILE" ]; then
        mkdir -p /var/lib/matrix-synapse
        ${pkgs.openssl}/bin/openssl rand -hex 32 > "$TOKEN_FILE"
        chmod 640 "$TOKEN_FILE"
        chown matrix-synapse:matrix-synapse "$TOKEN_FILE" 2>/dev/null || true
      fi
      
      # Append the registration_shared_secret to the config
      if [ -f "$TOKEN_FILE" ]; then
        SECRET=$(cat "$TOKEN_FILE")
        echo "registration_shared_secret: \"$SECRET\"" > /var/lib/matrix-synapse/extra.yaml
        chmod 640 /var/lib/matrix-synapse/extra.yaml
        chown matrix-synapse:matrix-synapse /var/lib/matrix-synapse/extra.yaml 2>/dev/null || true
      fi
    '';
  };

  # Ensure openssl is available for bootstrap
  environment.systemPackages = [ pkgs.openssl ];
}
