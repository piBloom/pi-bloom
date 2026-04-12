{ lib, config, pkgs, ... }:
{
  networking.hostName = "pocketbrain";
  nixpi.bootstrap.enable = false;
  nixpi.bootstrap.ssh.enable = false;
  nixpi.primaryUser = "alex";
  nixpi.timezone = "Europe/Bucharest";
  nixpi.keyboard = "us";

  nixpi.integrations.exa.enable = true;
  nixpi.security.fail2ban.enable = true;
  services.fail2ban.ignoreIP = [ "10.77.0.0/24" ];

  nixpi.security.ssh.allowedSourceCIDRs = [
    "188.24.176.127/32"
  ];

  services.openssh.enable = lib.mkForce true;
  services.resolved.enable = true;

  environment.systemPackages = with pkgs; [
    zellij
  ];

  programs.bash.loginShellInit = lib.mkAfter ''
    case "$-" in
      *i*)
        if [ -n "''${SSH_TTY-}" ] && [ -z "''${ZELLIJ-}" ] && [ -z "''${ZELLIJ_AUTO_ATTACH_DISABLED-}" ] && command -v zellij >/dev/null 2>&1; then
          case "''${TERM-}" in
            ""|dumb) ;;
            *) exec zellij attach -c main ;;
          esac
        fi
        ;;
    esac
  '';

  programs.bash.interactiveShellInit = lib.mkAfter ''
    path_without_nixos_sudo_entries=":$PATH:"
    path_without_nixos_sudo_entries="''${path_without_nixos_sudo_entries//:\/run\/wrappers\/bin:/:}"
    path_without_nixos_sudo_entries="''${path_without_nixos_sudo_entries//:\/run\/current-system\/sw\/bin:/:}"
    path_without_nixos_sudo_entries="''${path_without_nixos_sudo_entries#:}"
    path_without_nixos_sudo_entries="''${path_without_nixos_sudo_entries%:}"
    export PATH="/run/wrappers/bin:/run/current-system/sw/bin''${path_without_nixos_sudo_entries:+:$path_without_nixos_sudo_entries}"
  '';

  networking.firewall.allowedUDPPorts = [ 51820 ];
  networking.firewall.interfaces.wg0.allowedTCPPorts = [ 22 ];

  nixpi.signalGateway = {
    enable = true;
    account = "+40749599297";
    allowedNumbers = [ "+40724417990" ];
    adminNumbers = [ "+40724417990" ];
    stateDir = "/root/.local/state/nixpi-signal-gateway";
    piCwd = "/home/alex";
  };

  networking.wireguard.interfaces.wg0 = {
    ips = [ "10.77.0.1/24" ];
    listenPort = 51820;
    privateKeyFile = config.sops.secrets.wg-pocketbrain-private.path;

    peers = [
      {
        publicKey = "OfwY8zuWvmu8btdB5IzOc+Zzej98bkRa3rqFL1X3uhc=";
        allowedIPs = [ "10.77.0.10/32" ];
      }
      {
        publicKey = "P9RZFp4oNXfRHbBf7g79dxCkGP16ZpuN4EUb+dwHmWA=";
        allowedIPs = [ "10.77.0.20/32" ];
      }
    ];
  };

  users.users.alex.hashedPassword = "$6$720f881479249414$ytADpPX2vCIMPTV/nofX.YXFkXM.oi0kh3xu66Ejc2dP8RUZaNb/N7ib1YaPEl2ugouDs9MOurYAKB2JeNM8B.";

  users.users.root.hashedPassword = "$6$0633b7ec26ae8390$W42hfmWy0Y.nJ7SC4aSYNEtflDHfiPOQ9HMRc3ylLsKan0/xLSFUz0K.hp3jDQHS6daN54aQqTDt1dBUApwBy0";

  users.users.alex.openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGUUyhPt6Tsu+opLgmvLDVpTK+uz0ICpAIVhjTN3kGZ1 alex@yoga-laptop"
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA9DHvYnz64l4/CfGR2oMyjKMwTxN4ubLTisFmVGQv0U alex@nixos-laptop"
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPrEmvcVkdFAvLqEjbsXBOhpjFXtsUDjnQaPecRBrqpz alex@android-phone"
  ];
}
