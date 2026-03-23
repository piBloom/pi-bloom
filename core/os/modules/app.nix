# core/os/modules/app.nix
{ pkgs, lib, config, appPackage, piAgent, ... }:

let
  resolved = import ../lib/resolve-primary-user.nix { inherit lib config; };
  primaryUser = resolved.resolvedPrimaryUser;
  primaryHome = resolved.resolvedPrimaryHome;
  stateDir = config.nixpi.stateDir;
  agentStateDir = "${primaryHome}/.pi";
in

{
  imports = [ ./options.nix ];

  environment.systemPackages = [ appPackage piAgent ];

  systemd.tmpfiles.rules = [
    "L+ /usr/local/share/nixpi - - - - ${appPackage}/share/nixpi"
    "d /etc/nixpi/appservices 0755 root root -"
    "d ${stateDir} 0770 ${primaryUser} ${primaryUser} -"
    "d ${stateDir}/nixpi-daemon 0770 ${primaryUser} ${primaryUser} -"
    "d ${stateDir}/services 0770 ${primaryUser} ${primaryUser} -"
    "d ${stateDir}/services/home 0770 ${primaryUser} ${primaryUser} -"
    "d ${stateDir}/services/chat 0770 ${primaryUser} ${primaryUser} -"
  ];

  system.activationScripts.nixpi-app = lib.stringAfter [ "users" ] ''
    primary_group="$(id -gn ${primaryUser})"
    default_pi_settings="${appPackage}/share/nixpi/.pi/settings.json"

    install -d -m 0755 -o ${primaryUser} -g "$primary_group" ${primaryHome}
    install -d -m 0770 -o ${primaryUser} -g "$primary_group" ${stateDir}
    install -d -m 0700 -o ${primaryUser} -g "$primary_group" ${agentStateDir}

    if [ ! -e ${agentStateDir}/settings.json ] && [ -f "$default_pi_settings" ]; then
      install -m 0600 -o ${primaryUser} -g "$primary_group" "$default_pi_settings" ${agentStateDir}/settings.json
    fi

    chown -R ${primaryUser}:"$primary_group" ${agentStateDir}
    chmod 0700 ${agentStateDir}
  '';

  system.services.nixpi-daemon = {
    imports = [ (lib.modules.importApply ../services/nixpi-daemon.nix { inherit pkgs; }) ];
    nixpi-daemon = {
      package = appPackage;
      inherit primaryHome primaryUser stateDir agentStateDir;
      serviceUser = primaryUser;
      path = [ piAgent pkgs.nodejs ];
    };
  };
}
