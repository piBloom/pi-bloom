{ pkgs, ... }:
{
  services.smartd = {
    enable = true;
    autodetect = true;
  };

  systemd.services.nazar-mdraid-check = {
    description = "Check mdraid health for nazar";
    serviceConfig.Type = "oneshot";
    path = [
      pkgs.coreutils
      pkgs.gnugrep
    ];
    script = ''
      set -eu
      if [ ! -r /proc/mdstat ]; then
        echo "/proc/mdstat missing"
        exit 1
      fi
      cat /proc/mdstat
      if grep -Eq '\[[U_]+\]' /proc/mdstat && grep -Eq '\[_|_\]' /proc/mdstat; then
        echo "Degraded mdraid array detected" >&2
        exit 2
      fi
    '';
  };

  systemd.timers.nazar-mdraid-check = {
    description = "Run nazar mdraid health check hourly";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = "hourly";
      Persistent = true;
      Unit = "nazar-mdraid-check.service";
    };
  };
}
