{ pkgs, lib, config, ... }:

let
  resolved = import ../lib/resolve-primary-user.nix { inherit lib config; };
  primaryUser = resolved.resolvedPrimaryUser;
  primaryHome = resolved.resolvedPrimaryHome;

  openHome = pkgs.writeShellScriptBin "nixpi-open-home" ''
    set -euo pipefail
    exec ${pkgs.chromium}/bin/chromium --app=http://127.0.0.1:${toString config.nixpi.services.home.port}
  '';

  openChat = pkgs.writeShellScriptBin "nixpi-open-chat" ''
    set -euo pipefail
    exec ${pkgs.chromium}/bin/chromium --app=http://127.0.0.1:${toString config.nixpi.services.elementWeb.port}
  '';

  restartDesktop = pkgs.writeShellScriptBin "nixpi-restart-desktop-shell" ''
    set -euo pipefail
    pkill -u "$USER" -x tint2 || true
    pkill -u "$USER" -x dunst || true
    pkill -u "$USER" -x pcmanfm || true
    ${pkgs.openbox}/bin/openbox --reconfigure || true
    ${pkgs.dunst}/bin/dunst >/tmp/nixpi-dunst.log 2>&1 &
    ${pkgs.tint2}/bin/tint2 >/tmp/nixpi-tint2.log 2>&1 &
  '';

  homeDesktopItem = pkgs.makeDesktopItem {
    name = "nixpi-home";
    desktopName = "NixPI Home";
    genericName = "NixPI Home";
    exec = "${openHome}/bin/nixpi-open-home";
    terminal = false;
    categories = [ "Network" ];
  };

  chatDesktopItem = pkgs.makeDesktopItem {
    name = "nixpi-chat";
    desktopName = "NixPI Chat";
    genericName = "Element Web";
    exec = "${openChat}/bin/nixpi-open-chat";
    terminal = false;
    categories = [ "Network" "Chat" ];
  };

  restartDesktopItem = pkgs.makeDesktopItem {
    name = "nixpi-restart-desktop-shell";
    desktopName = "Restart Desktop Shell";
    exec = "${restartDesktop}/bin/nixpi-restart-desktop-shell";
    terminal = false;
    categories = [ "System" ];
  };

  desktopTerminal = pkgs.writeShellScriptBin "nixpi-open-desktop-terminal" ''
    set -euo pipefail

    if pgrep -u "${primaryUser}" -f "xterm.*NixPI (Terminal|Setup)" >/dev/null 2>&1; then
      exit 0
    fi

    title="NixPI Terminal"
    if [ ! -f "${primaryHome}/.nixpi/.setup-complete" ]; then
      title="NixPI Setup"
    fi

    exec ${pkgs.xterm}/bin/xterm \
      -title "$title" \
      -fa "Monospace" \
      -fs 12 \
      -fg "#e6edf3" \
      -bg "#10161d" \
      -geometry 132x36 \
      -e ${pkgs.bash}/bin/bash -lc '
        [ -f "${primaryHome}/.bashrc" ] && . "${primaryHome}/.bashrc"

        if [ ! -f "${primaryHome}/.nixpi/.setup-complete" ]; then
          if ! setup-wizard.sh; then
            echo ""
            echo "Setup paused because the last step failed."
            echo "Review the error above, fix the issue, then rerun: setup-wizard.sh"
          fi
          exec ${pkgs.bash}/bin/bash --login
        fi

        if [ -z "''${PI_SESSION:-}" ] && command -v pi >/dev/null 2>&1 && mkdir /tmp/.nixpi-pi-session 2>/dev/null; then
          trap "rmdir /tmp/.nixpi-pi-session 2>/dev/null" EXIT
          export PI_SESSION=1
          _nixpi_pkg="/usr/local/share/nixpi"
          _pi_settings="${primaryHome}/.pi/settings.json"
          if [ -d "$_nixpi_pkg" ]; then
            mkdir -p "$(dirname "$_pi_settings")"
            if [ -f "$_pi_settings" ] && command -v jq >/dev/null 2>&1; then
              if ! jq -e ".packages // [] | index(\"$_nixpi_pkg\")" "$_pi_settings" >/dev/null 2>&1; then
                jq ".packages = ((.packages // []) + [\"$_nixpi_pkg\"] | unique)" "$_pi_settings" > "''${_pi_settings}.tmp" && \
                  mv "''${_pi_settings}.tmp" "$_pi_settings"
              fi
            elif [ ! -f "$_pi_settings" ]; then
              cp "$_nixpi_pkg/.pi/settings.json" "$_pi_settings"
            fi
          fi
          unset _nixpi_pkg _pi_settings
          pi || true
        fi

        exec ${pkgs.bash}/bin/bash --login
      '
  '';

  openboxAutostart = pkgs.writeText "nixpi-openbox-autostart" ''
    ${pkgs.xsetroot}/bin/xsetroot -solid "#10161d"
    ${pkgs.dunst}/bin/dunst &
    ${pkgs.tint2}/bin/tint2 &
    ${desktopTerminal}/bin/nixpi-open-desktop-terminal &
  '';

  openboxRc = pkgs.writeText "nixpi-openbox-rc.xml" ''
    <?xml version="1.0" encoding="UTF-8"?>
    <openbox_config xmlns="http://openbox.org/3.4/rc">
      <resistance>
        <strength>10</strength>
        <screen_edge_strength>20</screen_edge_strength>
      </resistance>
      <focus>
        <focusNew>yes</focusNew>
        <followMouse>no</followMouse>
        <focusLast>yes</focusLast>
        <underMouse>no</underMouse>
      </focus>
      <placement>
        <policy>Smart</policy>
        <center>yes</center>
        <monitor>Primary</monitor>
      </placement>
      <theme>
        <name>Clearlooks</name>
        <titleLayout>NLIMC</titleLayout>
      </theme>
      <desktops>
        <number>1</number>
        <popupTime>0</popupTime>
      </desktops>
      <applications/>
      <keyboard>
        <chainQuitKey>C-g</chainQuitKey>
        <keybind key="W-space">
          <action name="Execute">
            <command>${pkgs.rofi}/bin/rofi -show drun</command>
          </action>
        </keybind>
        <keybind key="W-Return">
          <action name="Execute">
            <command>${pkgs.xterm}/bin/xterm</command>
          </action>
        </keybind>
        <keybind key="W-f">
          <action name="Execute">
            <command>${pkgs.pcmanfm}/bin/pcmanfm</command>
          </action>
        </keybind>
      </keyboard>
      <mouse>
        <doubleClickTime>500</doubleClickTime>
        <screenEdgeWarpTime>0</screenEdgeWarpTime>
        <screenEdgeWarpMouse>false</screenEdgeWarpMouse>
      </mouse>
      <margins>
        <top>0</top>
        <bottom>36</bottom>
        <left>0</left>
        <right>0</right>
      </margins>
    </openbox_config>
  '';

  tint2Config = pkgs.writeText "nixpi-tint2rc" ''
    rounded = 0
    border_width = 0
    background_color = #0b1117 100
    border_color = #0b1117 100

    panel_monitor = all
    panel_position = bottom center horizontal
    panel_size = 100% 36
    panel_margin = 0 0
    panel_padding = 10 6 10
    panel_items = TSC
    panel_background_id = 0
    wm_menu = 1
    panel_dock = 0
    panel_layer = top
    panel_pivot_struts = 0

    taskbar_mode = single_desktop
    taskbar_padding = 6 0 6
    taskbar_background_id = 0

    task_text = 1
    task_centered = 1
    task_padding = 10 4 10
    task_background_id = 0
    task_active_background_id = 0
    task_iconified_background_id = 0

    systray_padding = 6 2 6
    systray_background_id = 0

    time1_format = %H:%M
    time1_font = Sans 10
    clock_padding = 8 0
    clock_background_id = 0
  '';
in
{
  imports = [ ./options.nix ];

  assertions = [
    {
      assertion = primaryUser != "";
      message = "nixpi.primaryUser must resolve before enabling the Openbox desktop session.";
    }
    {
      assertion = primaryHome != "";
      message = "nixpi.primaryHome must resolve before enabling the Openbox desktop session.";
    }
  ];

  environment.systemPackages = with pkgs; [
    chromium
    dunst
    imagemagick
    openbox
    pcmanfm
    rofi
    tint2
    tesseract
    wmctrl
    xclip
    xdotool
    xprop
    xsetroot
    xterm
    scrot
    openHome
    openChat
    restartDesktop
    desktopTerminal
    homeDesktopItem
    chatDesktopItem
    restartDesktopItem
  ];

  services.xserver.enable = true;
  services.xserver.windowManager.openbox.enable = true;
  services.xserver.displayManager.lightdm.enable = true;
  services.displayManager.defaultSession = lib.mkDefault "none+openbox";
  services.displayManager.autoLogin.enable = true;
  services.displayManager.autoLogin.user = primaryUser;
  services.xserver.displayManager.lightdm.greeters.gtk.enable = true;
  systemd.defaultUnit = lib.mkDefault "graphical.target";

  environment.etc = {
    "skel/.config/openbox/autostart".source = openboxAutostart;
    "skel/.config/openbox/rc.xml".source = openboxRc;
    "skel/.config/tint2/tint2rc".source = tint2Config;
  };

  system.activationScripts.nixpi-openbox-desktop = lib.stringAfter [ "users" ] ''
    primary_group="$(id -gn ${primaryUser})"

    install -d -m 0755 -o ${primaryUser} -g "$primary_group" ${primaryHome}/.config
    install -d -m 0755 -o ${primaryUser} -g "$primary_group" ${primaryHome}/.config/openbox
    install -d -m 0755 -o ${primaryUser} -g "$primary_group" ${primaryHome}/.config/tint2

    if [ ! -e ${primaryHome}/.config/openbox/autostart ]; then
      install -m 0644 -o ${primaryUser} -g "$primary_group" /etc/skel/.config/openbox/autostart ${primaryHome}/.config/openbox/autostart
    fi

    if [ ! -e ${primaryHome}/.config/openbox/rc.xml ]; then
      install -m 0644 -o ${primaryUser} -g "$primary_group" /etc/skel/.config/openbox/rc.xml ${primaryHome}/.config/openbox/rc.xml
    fi

    if [ ! -e ${primaryHome}/.config/tint2/tint2rc ]; then
      install -m 0644 -o ${primaryUser} -g "$primary_group" /etc/skel/.config/tint2/tint2rc ${primaryHome}/.config/tint2/tint2rc
    fi
  '';
}
