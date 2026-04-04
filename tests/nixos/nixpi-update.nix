{ lib, nixPiModulesNoShell, mkTestFilesystems, piAgent, appPackage, ... }:

let
  commonNodeModule = { ... }: {
    nixpi.primaryUser = "tester";

    networking.hostName = "nixpi-update-test";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";

    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;

    users.users.tester = {
      isNormalUser = true;
      group = "tester";
      initialPassword = "test";
    };
    users.groups.tester = {};
  };

in
{
  name = "nixpi-update";

  nodes.machine = { pkgs, ... }:
    let
      system = pkgs.stdenv.hostPlatform.system;

      systemNew = (import "${pkgs.path}/nixos/lib/eval-config.nix" {
        inherit system;
        specialArgs = { inherit piAgent appPackage; };
        modules = nixPiModulesNoShell ++ [
          mkTestFilesystems
          commonNodeModule
          {
            nixpkgs.hostPlatform = system;
            nixpkgs.pkgs = pkgs;
          }
          ({ pkgs, ... }: {
            environment.systemPackages = [ pkgs.hello ];
          })
        ];
      }).config.system.build.toplevel;

      testUpdateScript = pkgs.writeShellScript "nixpi-update-test-cmd" ''
        set -euo pipefail

        NIXPI_PRIMARY_USER="''${NIXPI_PRIMARY_USER:-tester}"
        NIXPI_PRIMARY_HOME="/home/''${NIXPI_PRIMARY_USER}"
        STATUS_DIR="''${NIXPI_PRIMARY_HOME}/.nixpi"
        STATUS_FILE="''${STATUS_DIR}/update-status.json"
        NEXT_SYSTEM_FILE="/run/nixpi-update-test/next-system"
        CHECKED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

        mkdir -p "$STATUS_DIR"
        chown "$NIXPI_PRIMARY_USER" "$STATUS_DIR" 2>/dev/null || true

        CURRENT_GEN=$(nix-env --list-generations -p /nix/var/nix/profiles/system 2>/dev/null | grep current | awk '{print $1}' || echo "0")
        CURRENT_SYSTEM=$(readlink /run/current-system)
        NEW_SYSTEM=$(cat "$NEXT_SYSTEM_FILE" 2>/dev/null || echo "")

        if [[ -z "$NEW_SYSTEM" ]] || [[ "$NEW_SYSTEM" == "$CURRENT_SYSTEM" ]]; then
          AVAILABLE=false
        else
          AVAILABLE=true
        fi

        NOTIFIED=false
        if [[ -f "$STATUS_FILE" ]] && [[ "$AVAILABLE" = "true" ]]; then
          NOTIFIED=$(jq -r '.notified // false' "$STATUS_FILE" 2>/dev/null || echo "false")
        fi

        jq -n \
          --arg checked "$CHECKED" \
          --argjson available "$AVAILABLE" \
          --arg generation "$CURRENT_GEN" \
          --argjson notified "$NOTIFIED" \
          '{"checked": $checked, "available": $available, "generation": $generation, "notified": $notified}' \
          > "$STATUS_FILE"
        chown "$NIXPI_PRIMARY_USER" "$STATUS_FILE"

        if [[ "$AVAILABLE" = "true" ]]; then
          nix-env -p /nix/var/nix/profiles/system --set "$NEW_SYSTEM"
          ln -sfn "$NEW_SYSTEM" /run/current-system

          NEW_GEN=$(nix-env --list-generations -p /nix/var/nix/profiles/system 2>/dev/null | grep current | awk '{print $1}' || echo "0")
          jq -n \
            --arg checked "$CHECKED" \
            --arg generation "$NEW_GEN" \
            '{"checked": $checked, "available": false, "generation": $generation, "notified": false}' \
            > "$STATUS_FILE"
          chown "$NIXPI_PRIMARY_USER" "$STATUS_FILE"
        fi
      '';
    in {
      imports = nixPiModulesNoShell ++ [
        mkTestFilesystems
        commonNodeModule
      ];
      _module.args = { inherit piAgent appPackage; };

      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;
      virtualisation.additionalPaths = [ systemNew ];

      systemd.timers.nixpi-update.wantedBy = lib.mkForce [ ];
      system.services.nixpi-update.nixpi-update.command = lib.mkForce testUpdateScript;

      systemd.tmpfiles.rules = [
        "d /etc/nixos 0755 root root -"
        "d /run/nixpi-update-test 0755 root root -"
      ];

      environment.etc."nixpi-update-test/system-new".text = "${systemNew}";
      environment.etc."nixpi-update-test/command".text = "${testUpdateScript}";
    };

  testScript = ''
    import json

    def run_update():
        machine.succeed(
            "sh -lc '"
            + "rm -f /tmp/nixpi-update.log /tmp/nixpi-update.exit; "
            + "CMD=$(cat /etc/nixpi-update-test/command); "
            + "nohup sh -lc "
            + "\"env PATH=/run/current-system/sw/bin "
            + "NIXPI_PRIMARY_USER=tester "
            + "\\\"$CMD\\\"; "
            + "printf %s \\$? >/tmp/nixpi-update.exit\" "
            + ">/tmp/nixpi-update.log 2>&1 </dev/null &'"
        )
        machine.wait_until_succeeds("test -f /tmp/nixpi-update.exit", timeout=300)
        exit_code = machine.succeed("cat /tmp/nixpi-update.exit").strip()
        assert exit_code == "0", machine.succeed("cat /tmp/nixpi-update.log")

    machine.start()
    machine.wait_for_unit("multi-user.target", timeout=300)

    machine.succeed("printf '{\\n}\\n' > /etc/nixos/flake.nix")
    machine.succeed("test -f /etc/nixos/flake.nix")

    current = machine.succeed("readlink /run/current-system").strip()
    machine.succeed(f"printf '%s\\n' '{current}' > /run/nixpi-update-test/next-system")

    gen_before = int(machine.succeed(
        "nix-env --list-generations -p /nix/var/nix/profiles/system | wc -l"
    ).strip())
    run_update()

    status = json.loads(machine.succeed("cat /home/tester/.nixpi/update-status.json"))
    assert status["available"] is False, f"Phase 1: expected available=false, got {status}"

    gen_after = int(machine.succeed(
        "nix-env --list-generations -p /nix/var/nix/profiles/system | wc -l"
    ).strip())
    assert gen_after == gen_before, (
        f"Phase 1: generation count changed unexpectedly ({gen_before} -> {gen_after})"
    )

    new_system = machine.succeed("cat /etc/nixpi-update-test/system-new").strip()
    assert new_system, "Missing precomputed systemNew path"
    assert new_system != current, "systemNew unexpectedly matches the current system"

    machine.succeed(f"printf '%s\\n' '{new_system}' > /run/nixpi-update-test/next-system")

    gen_before = int(machine.succeed(
        "nix-env --list-generations -p /nix/var/nix/profiles/system | wc -l"
    ).strip())
    run_update()

    status = json.loads(machine.succeed("cat /home/tester/.nixpi/update-status.json"))
    assert status["available"] is False, f"Phase 2: expected available=false after apply, got {status}"

    gen_after = int(machine.succeed(
        "nix-env --list-generations -p /nix/var/nix/profiles/system | wc -l"
    ).strip())
    assert gen_after == gen_before + 1, (
        f"Phase 2: expected generation +1 ({gen_before} -> {gen_after})"
    )

    machine.succeed("test -x /run/current-system/sw/bin/hello")

    print("All nixpi-update tests passed!")
  '';
}
