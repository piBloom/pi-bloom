# core/os/modules/shell.nix
{ pkgs, lib, config, ... }:

let
  u = config.nixpi.username;

  bashrc = pkgs.writeText "workspace-bashrc" ''
    export WORKSPACE_DIR="$HOME/Workspace"
    export BROWSER="chromium"
    export PATH="/usr/local/share/workspace/node_modules/.bin:$PATH"
  '';

  bashProfile = pkgs.writeText "workspace-bash_profile" ''
    # Source .bashrc for env vars (WORKSPACE_DIR, PATH, etc.)
    [ -f ~/.bashrc ] && . ~/.bashrc

    # First-boot wizard — loop until complete, Ctrl+C restarts it
    while [ -t 0 ] && [ ! -f "$HOME/.workspace/.setup-complete" ]; do
      setup-wizard.sh || true
    done

    # On TTY1 with setup complete, start Sway window manager
    if [ "$(tty)" = "/dev/tty1" ] && [ -f "$HOME/.workspace/.setup-complete" ]; then
      export XDG_SESSION_TYPE=wayland
      export XDG_CURRENT_DESKTOP=sway
      export MOZ_ENABLE_WAYLAND=1
      export QT_QPA_PLATFORM=wayland
      export SDL_VIDEODRIVER=wayland
      export _JAVA_AWT_WM_NONREPARENTING=1

      exec sway
    fi

    # Start Pi on interactive login (only after setup, only one instance — atomic mkdir lock)
    if [ -t 0 ] && [ -f "$HOME/.workspace/.setup-complete" ] && [ -z "$PI_SESSION" ] && mkdir /tmp/.workspace-pi-session 2>/dev/null; then
      trap 'rmdir /tmp/.workspace-pi-session 2>/dev/null' EXIT
      export PI_SESSION=1
      login-greeting.sh
      exec pi
    fi
  '';
in
{
  imports = [ ./options.nix ];

  users.users.${u} = {
    isNormalUser = true;
    group        = u;
    extraGroups  = [ "wheel" "networkmanager" ];
    home         = "/home/${u}";
    shell        = pkgs.bash;
    # No initial password — set interactively by setup-wizard.sh on first boot.
  };
  users.groups.${u} = {};

  security.sudo.extraRules = [
    {
      users    = [ u ];
      commands = [ { command = "ALL"; options = [ "NOPASSWD" ]; } ];
    }
  ];

  services.getty.autologinUser = lib.mkForce u;

  systemd.services."serial-getty@ttyS0" = {
    overrideStrategy = "asDropin";
    serviceConfig.ExecStart = lib.mkForce [
      ""
      "${pkgs.util-linux}/sbin/agetty --autologin ${u} --keep-baud 115200,57600,38400,9600 ttyS0 $TERM"
    ];
  };

  environment.etc = {
    "skel/.bashrc".source       = bashrc;
    "skel/.bash_profile".source = bashProfile;
    "issue".text = "nixPI\n";
    "xdg/sway/config".text = ''
      # Workspace OS Sway Configuration
      set $mod Mod4
      set $term foot
      set $menu wmenu-run

      # Font for window titles
      font pango:monospace 10

      # Use Mouse+$mod to drag floating windows
      floating_modifier $mod normal

      # Start terminal
      bindsym $mod+Return exec $term

      # Kill focused window
      bindsym $mod+Shift+q kill

      # Start launcher
      bindsym $mod+d exec $menu

      # Reload configuration
      bindsym $mod+Shift+c reload

      # Exit Sway
      bindsym $mod+Shift+e exec swaynag -t warning -m 'Exit Sway?' -B 'Yes' 'swaymsg exit'

      # Move focus
      bindsym $mod+h focus left
      bindsym $mod+j focus down
      bindsym $mod+k focus up
      bindsym $mod+l focus right

      # Move windows
      bindsym $mod+Shift+h move left
      bindsym $mod+Shift+j move down
      bindsym $mod+Shift+k move up
      bindsym $mod+Shift+l move right

      # Workspaces
      bindsym $mod+1 workspace number 1
      bindsym $mod+2 workspace number 2
      bindsym $mod+3 workspace number 3
      bindsym $mod+4 workspace number 4
      bindsym $mod+5 workspace number 5

      # Move to workspace
      bindsym $mod+Shift+1 move container to workspace number 1
      bindsym $mod+Shift+2 move container to workspace number 2
      bindsym $mod+Shift+3 move container to workspace number 3
      bindsym $mod+Shift+4 move container to workspace number 4
      bindsym $mod+Shift+5 move container to workspace number 5

      # Layout
      bindsym $mod+b splith
      bindsym $mod+v splitv
      bindsym $mod+s layout stacking
      bindsym $mod+w layout tabbed
      bindsym $mod+e layout toggle split

      # Fullscreen
      bindsym $mod+f fullscreen toggle

      # Floating
      bindsym $mod+Shift+space floating toggle
      bindsym $mod+space focus mode_toggle

      # Resize mode
      mode "resize" {
          bindsym h resize shrink width 10px
          bindsym j resize grow height 10px
          bindsym k resize shrink height 10px
          bindsym l resize grow width 10px
          bindsym Return mode "default"
          bindsym Escape mode "default"
      }
      bindsym $mod+r mode "resize"

      # Brightness and volume keys
      bindsym XF86MonBrightnessUp exec brightnessctl set +5%
      bindsym XF86MonBrightnessDown exec brightnessctl set 5%-
      bindsym XF86AudioRaiseVolume exec pamixer -i 5
      bindsym XF86AudioLowerVolume exec pamixer -d 5
      bindsym XF86AudioMute exec pamixer -t

      # Status bar
      bar {
          position top
          status_command while date +'%Y-%m-%d %H:%M:%S'; do sleep 1; done
          colors {
              statusline #ffffff
              background #323232
          }
      }

      # Window borders
      default_border pixel 2
      default_floating_border pixel 2

      # Autostart Pi in a terminal
      exec $term -e bash -c 'login-greeting.sh && exec pi'
      '';
  };

  systemd.tmpfiles.rules = [
    "C /home/${u}/.bashrc       0644 ${u} ${u} - /etc/skel/.bashrc"
    "C /home/${u}/.bash_profile 0644 ${u} ${u} - /etc/skel/.bash_profile"
  ];

  boot.kernel.sysctl."kernel.printk" = "4 4 1 7";

  networking.hostName = lib.mkDefault "nixos";
}
