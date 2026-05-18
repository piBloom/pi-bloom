{
  config,
  lib,
  pkgs,
  ...
}:
let
  tailnetInterface = "tailscale0";
  radicalePort = 5232;
in
{
  services.radicale = {
    enable = true;
    settings = {
      server = {
        hosts = [
          "0.0.0.0:${toString radicalePort}"
          "[::]:${toString radicalePort}"
        ];
      };
      auth = {
        # Nazar's Radicale endpoint is private to the Tailscale interface below.
        # Keep application credentials out of the Nix store for now; add an
        # htpasswd runtime secret later if this becomes multi-user or public.
        type = "none";
      };
      storage = {
        filesystem_folder = "/var/lib/radicale/collections";
      };
    };
  };

  networking.firewall.interfaces.${tailnetInterface}.allowedTCPPorts = [ radicalePort ];

  systemd.services.life-os-radicale-init = {
    description = "Ensure default Life OS Radicale collections exist";
    after = [ "radicale.service" ];
    requires = [ "radicale.service" ];
    wantedBy = [ "multi-user.target" ];
    path = [ pkgs.curl ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      set -euo pipefail

      base="http://127.0.0.1:${toString radicalePort}"

      exists() {
        curl --fail --silent --show-error \
          -X PROPFIND \
          -H 'Depth: 0' \
          -o /dev/null \
          "$base/$1/"
      }

      if ! exists alex; then
        curl --fail --silent --show-error -X MKCOL "$base/alex/" -o /dev/null
      fi

      if ! exists alex/life-os; then
        curl --fail --silent --show-error \
          -X MKCALENDAR \
          -H 'Content-Type: application/xml; charset=utf-8' \
          --data-binary @- \
          "$base/alex/life-os/" \
          -o /dev/null <<'XML'
      <C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:set><D:prop>
          <D:displayname>Life OS</D:displayname>
          <C:calendar-description>Life OS calendar, tasks, and reminders</C:calendar-description>
          <C:supported-calendar-component-set>
            <C:comp name="VEVENT"/>
            <C:comp name="VTODO"/>
          </C:supported-calendar-component-set>
        </D:prop></D:set>
      </C:mkcalendar>
      XML
      fi

      if ! exists alex/contacts; then
        curl --fail --silent --show-error \
          -X MKCOL \
          -H 'Content-Type: application/xml; charset=utf-8' \
          --data-binary @- \
          "$base/alex/contacts/" \
          -o /dev/null <<'XML'
      <D:mkcol xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
        <D:set><D:prop>
          <D:resourcetype><D:collection/><CR:addressbook/></D:resourcetype>
          <D:displayname>Life OS Contacts</D:displayname>
        </D:prop></D:set>
      </D:mkcol>
      XML
      fi
    '';
  };

  assertions = [
    {
      assertion = config.services.tailscale.enable;
      message = "Life OS Radicale requires services.tailscale.enable = true.";
    }
    {
      assertion = lib.elem radicalePort (
        config.networking.firewall.interfaces.${tailnetInterface}.allowedTCPPorts or [ ]
      );
      message = "Life OS Radicale expects TCP/${toString radicalePort} to be allowed on ${tailnetInterface} only.";
    }
    {
      assertion = !(lib.elem radicalePort (config.networking.firewall.allowedTCPPorts or [ ]));
      message = "Life OS Radicale must not be globally exposed; expose it through ${tailnetInterface} only.";
    }
  ];
}
