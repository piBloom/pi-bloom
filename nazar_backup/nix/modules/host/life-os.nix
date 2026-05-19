{ pkgs, ... }:
let
  lifeOs = pkgs.callPackage ../../../packages/life-os/package.nix { };
in
{
  environment.systemPackages = [ lifeOs ];

  systemd.tmpfiles.rules = [
    "d /srv/life 0750 alex users - -"
    "d /srv/life/config 0750 alex users - -"
    "d /srv/life/calendar 0750 alex users - -"
    "d /srv/life/tasks 0750 alex users - -"
    "d /srv/life/projects 0750 alex users - -"
    "d /srv/life/projects/active 0750 alex users - -"
    "d /srv/life/projects/archived 0750 alex users - -"
    "d /srv/life/journal 0750 alex users - -"
    "d /srv/life/habits 0750 alex users - -"
    "d /srv/life/notes 0750 alex users - -"
    "d /srv/life/exports 0750 alex users - -"
    "d /srv/life/scripts 0750 alex users - -"
    "d /srv/life/var 0750 alex users - -"
    "d /srv/life/var/cache 0750 alex users - -"
    "d /srv/life/var/indexes 0750 alex users - -"
    "d /srv/life/var/state 0750 alex users - -"
  ];
}
