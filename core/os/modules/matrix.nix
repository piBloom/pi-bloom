# core/os/modules/matrix.nix
{ pkgs, config, lib, ... }:

let
  tomlFormat = pkgs.formats.toml { };
  resolved = import ../lib/resolve-primary-user.nix { inherit lib config; };
  primaryHome = resolved.resolvedPrimaryHome;
  stateDir = config.nixpi.stateDir;
  secretDir = "${stateDir}/secrets";
  setupCompleteFile = "${primaryHome}/.nixpi/.setup-complete";
  matrixBindsLocally =
    config.nixpi.matrix.bindAddress == "127.0.0.1"
    || config.nixpi.matrix.bindAddress == "::1"
    || config.nixpi.matrix.bindAddress == "localhost";
  generatedRegistrationSecretFile = "${secretDir}/matrix-registration-shared-secret";
  registrationSecretFile =
    if config.nixpi.matrix.registrationSharedSecretFile != null then
      config.nixpi.matrix.registrationSharedSecretFile
    else
      generatedRegistrationSecretFile;
  uploadSizeMatch = builtins.match "^([0-9]+)([KkMmGg]?)$" config.nixpi.matrix.maxUploadSize;
  uploadSizeValue =
    if uploadSizeMatch == null then
      throw "nixpi.matrix.maxUploadSize must use the form <int>[K|M|G], for example 20M."
    else
      lib.toInt (builtins.elemAt uploadSizeMatch 0);
  uploadSizeSuffix = if uploadSizeMatch == null then "" else builtins.elemAt uploadSizeMatch 1;
  uploadSizeMultiplier =
    if builtins.elem uploadSizeSuffix [ "" ] then 1 else
    if builtins.elem uploadSizeSuffix [ "K" "k" ] then 1000 else
    if builtins.elem uploadSizeSuffix [ "M" "m" ] then 1000 * 1000 else
    if builtins.elem uploadSizeSuffix [ "G" "g" ] then 1000 * 1000 * 1000 else
    throw "Unsupported nixpi.matrix.maxUploadSize suffix `${uploadSizeSuffix}`.";
  maxRequestSize = uploadSizeValue * uploadSizeMultiplier;
  managedGlobalSettingNames = [
    "server_name"
    "address"
    "port"
    "database_path"
    "max_request_size"
    "allow_registration"
    "registration_token"
    "allow_federation"
    "trusted_servers"
    "allow_announcements_check"
  ];
  managedRootSettingNames = [
    "admin_execute"
  ];
  matrixSettings = config.services.matrix-continuwuity.settings;
  extraGlobalSettings =
    lib.filterAttrs (name: _: !(builtins.elem name managedGlobalSettingNames))
      (matrixSettings.global or { });
  extraRootSettings = builtins.removeAttrs matrixSettings ([ "global" ] ++ managedRootSettingNames);
  adminExecuteSettings = lib.optionalAttrs (matrixSettings ? admin_execute) {
    admin_execute = matrixSettings.admin_execute;
  };
  extraGlobalSettingsToml = tomlFormat.generate "continuwuity-global-extra.toml" { global = extraGlobalSettings; };
  extraRootSettingsToml = tomlFormat.generate "continuwuity-extra.toml" extraRootSettings;
  adminExecuteToml = tomlFormat.generate "continuwuity-admin-execute.toml" adminExecuteSettings;
in
{
  imports = [ ./options.nix ];

  assertions = [
    {
      assertion = config.nixpi.matrix.bindAddress != "";
      message = "nixpi.matrix.bindAddress must not be empty.";
    }
  ];

  systemd.tmpfiles.rules = [
    "d ${secretDir} 0750 root continuwuity -"
    "d /var/lib/continuwuity 0750 continuwuity continuwuity -"
  ];

  services.matrix-continuwuity = {
    enable = true;
    settings.global = {
      server_name = config.networking.hostName;
      address = [ config.nixpi.matrix.bindAddress ];
      port = [ config.nixpi.matrix.port ];
      max_request_size = maxRequestSize;
      allow_registration = false;
      allow_federation = false;
      trusted_servers = [ ];
      allow_announcements_check = false;
    };
  };

  # Generate a mutable runtime config so registration can close automatically
  # once first-boot setup completes, while keeping the homeserver package declarative.
  systemd.services.continuwuity = {
    environment.CONTINUWUITY_CONFIG = lib.mkForce "/var/lib/continuwuity/continuwuity.toml";
    serviceConfig = {
      PermissionsStartOnly = true;
    };
    preStart = ''
      TOKEN_FILE="${registrationSecretFile}"
      if [ ! -f "$TOKEN_FILE" ]; then
        ${pkgs.openssl}/bin/openssl rand -hex 32 > "$TOKEN_FILE"
        chown root:continuwuity "$TOKEN_FILE"
        chmod 0640 "$TOKEN_FILE"
      fi
      REGISTRATION_TOKEN="$(tr -d '\n' < "$TOKEN_FILE")"

      ENABLE_REGISTRATION="${if config.nixpi.matrix.keepRegistrationAfterSetup then (if config.nixpi.matrix.enableRegistration then "true" else "false") else "dynamic"}"
      if [ "$ENABLE_REGISTRATION" = "dynamic" ]; then
        if [ -f "${setupCompleteFile}" ]; then
          ENABLE_REGISTRATION="false"
        else
          ENABLE_REGISTRATION="${if config.nixpi.matrix.enableRegistration then "true" else "false"}"
        fi
      fi

      cat > /var/lib/continuwuity/continuwuity.toml <<EOF
[global]
server_name = "${config.networking.hostName}"
address = ["${config.nixpi.matrix.bindAddress}"]
port = [${toString config.nixpi.matrix.port}]
database_path = "/var/lib/continuwuity"
max_request_size = ${toString maxRequestSize}
allow_registration = $ENABLE_REGISTRATION
registration_token = "$REGISTRATION_TOKEN"
allow_federation = false
trusted_servers = []
allow_announcements_check = false
EOF
      if [ -s "${extraGlobalSettingsToml}" ]; then
        sed '1d' "${extraGlobalSettingsToml}" >> /var/lib/continuwuity/continuwuity.toml
      fi
      if [ -s "${extraRootSettingsToml}" ]; then
        printf '\n' >> /var/lib/continuwuity/continuwuity.toml
        cat "${extraRootSettingsToml}" >> /var/lib/continuwuity/continuwuity.toml
      fi
      if [ ! -f "${setupCompleteFile}" ] && [ -s "${adminExecuteToml}" ]; then
        printf '\n' >> /var/lib/continuwuity/continuwuity.toml
        cat "${adminExecuteToml}" >> /var/lib/continuwuity/continuwuity.toml
      fi
      chown root:continuwuity /var/lib/continuwuity/continuwuity.toml
      chmod 0640 /var/lib/continuwuity/continuwuity.toml
    '';
  };

  # Ensure openssl is available for bootstrap
  environment.systemPackages = [ pkgs.openssl ];

  warnings = lib.optional
    (config.nixpi.matrix.enableRegistration
      && !config.nixpi.security.enforceServiceFirewall
      && !matrixBindsLocally) ''
    NixPI Matrix registration is enabled while Continuwuity is listening on
    `${config.nixpi.matrix.bindAddress}` without the trusted-interface firewall
    restriction. Registration should be disabled or Matrix should be kept local.
  '';
}
