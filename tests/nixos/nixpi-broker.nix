{ nixPiModules, mkTestFilesystems, ... }:

{
  name = "nixpi-broker";

  nodes = {
    maintain = _: {
      imports = nixPiModules ++ [
        ../../core/os/modules/broker.nix
        mkTestFilesystems
      ];

      nixpi = {
        primaryUser = "maintainer";
        agent = {
          autonomy = "maintain";
          osUpdate.enable = false;
        };
      };

      networking.hostName = "maintain";
    };

    observe = _: {
      imports = nixPiModules ++ [
        ../../core/os/modules/broker.nix
        mkTestFilesystems
      ];

      nixpi = {
        primaryUser = "observer";
        agent.autonomy = "observe";
      };

      networking.hostName = "observe";
    };
  };

  testScript = ''
    import json
    import shlex

    maintain = machines[0]
    observe = machines[1]

    def succeed_as_user(machine, user, command):
        return machine.succeed(f"sudo -u {user} -- bash -lc {shlex.quote(command)}")

    def fail_as_user(machine, user, command):
        return machine.fail(f"sudo -u {user} -- bash -lc {shlex.quote(command)}")

    start_all()

    for machine, expected_group in [(maintain, "maintainer"), (observe, "observer")]:
        machine.wait_for_unit("multi-user.target", timeout=300)
        machine.wait_for_unit("nixpi-broker.socket", timeout=120)
        machine.wait_until_succeeds("test -S /run/nixpi-broker/broker.sock", timeout=60)
        machine.succeed("systemctl show nixpi-broker.socket -p Listen --value | grep -F '/run/nixpi-broker/broker.sock'")
        machine.fail("systemctl is-active nixpi-broker.service")
        machine.succeed(f"stat -c '%U:%G %a' /run/nixpi-broker/broker.sock | grep -qx 'root:{expected_group} 660'")

    maintain_status = json.loads(succeed_as_user(maintain, "maintainer", "nixpi-brokerctl status"))
    assert maintain_status["defaultAutonomy"] == "maintain", maintain_status
    assert maintain_status["effectiveAutonomy"] == "maintain", maintain_status

    observe_status = json.loads(succeed_as_user(observe, "observer", "nixpi-brokerctl status"))
    assert observe_status["defaultAutonomy"] == "observe", observe_status
    assert observe_status["effectiveAutonomy"] == "observe", observe_status

    # Observe can inspect allowed units through the socket but cannot mutate them.
    succeed_as_user(observe, "observer", "nixpi-brokerctl systemd status nixpi-update.service >/dev/null")
    observe.wait_for_unit("nixpi-broker.service", timeout=120)
    fail_as_user(observe, "observer", "nixpi-brokerctl systemd restart nixpi-update.service")

    # Maintain can manage allowed units through the socket but cannot use admin-only operations.
    succeed_as_user(maintain, "maintainer", "nixpi-brokerctl systemd restart nixpi-update.service")
    maintain.wait_for_unit("nixpi-broker.service", timeout=120)
    fail_as_user(maintain, "maintainer", "nixpi-brokerctl systemd status sshd.service")
    fail_as_user(maintain, "maintainer", "nixpi-brokerctl nixos-update rollback")

    # The primary operator gets passwordless elevation rules, and the broker
    # state machine accepts a temporary admin grant from the operator context.
    maintain.succeed("grep -q 'nixpi-brokerctl grant-admin' /etc/sudoers")
    maintain.succeed("grep -q 'NOPASSWD' /etc/sudoers")
    succeed_as_user(maintain, "maintainer", "sudo -n nixpi-brokerctl grant-admin 5m >/tmp/grant.json")
    elevated = json.loads(succeed_as_user(maintain, "maintainer", "sudo -n nixpi-brokerctl status"))
    assert elevated["effectiveAutonomy"] == "admin", elevated

    # Admin passes the permission gate, then hits the explicit OS-update disable check.
    fail_as_user(maintain, "maintainer", "nixpi-brokerctl nixos-update apply >/tmp/update.out 2>/tmp/update.err")
    succeed_as_user(maintain, "maintainer", "grep -q 'OS updates are disabled' /tmp/update.err")

    succeed_as_user(maintain, "maintainer", "sudo -n nixpi-brokerctl revoke-admin >/tmp/revoke.json")
    revoked = json.loads(succeed_as_user(maintain, "maintainer", "sudo -n nixpi-brokerctl status"))
    assert revoked["effectiveAutonomy"] == "maintain", revoked

    print("NixPI broker autonomy test passed!")
  '';
}
