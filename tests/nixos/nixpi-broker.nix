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

    maintain = machines[0]
    observe = machines[1]

    start_all()

    for machine in [maintain, observe]:
        machine.wait_for_unit("multi-user.target", timeout=300)
        machine.wait_for_unit("nixpi-broker.service", timeout=120)
        machine.wait_until_succeeds("test -S /run/nixpi-broker/broker.sock", timeout=60)

    maintain_status = json.loads(maintain.succeed("nixpi-brokerctl status"))
    assert maintain_status["defaultAutonomy"] == "maintain", maintain_status
    assert maintain_status["effectiveAutonomy"] == "maintain", maintain_status

    observe_status = json.loads(observe.succeed("nixpi-brokerctl status"))
    assert observe_status["defaultAutonomy"] == "observe", observe_status
    assert observe_status["effectiveAutonomy"] == "observe", observe_status

    # Observe can inspect allowed units but cannot mutate them.
    observe.succeed("nixpi-brokerctl systemd status nixpi-ttyd.service >/dev/null")
    observe.fail("nixpi-brokerctl systemd restart nixpi-ttyd.service")

    # Maintain can manage allowed units but cannot use admin-only operations.
    maintain.succeed("nixpi-brokerctl systemd restart nixpi-ttyd.service")
    maintain.fail("nixpi-brokerctl systemd status sshd.service")
    maintain.fail("nixpi-brokerctl nixos-update rollback")

    # The primary operator gets passwordless elevation rules, and the broker
    # state machine accepts a temporary admin grant.
    maintain.succeed("grep -q 'nixpi-brokerctl grant-admin' /etc/sudoers")
    maintain.succeed("grep -q 'NOPASSWD' /etc/sudoers")
    maintain.succeed("nixpi-brokerctl grant-admin 5m >/tmp/grant.json")
    elevated = json.loads(maintain.succeed("nixpi-brokerctl status"))
    assert elevated["effectiveAutonomy"] == "admin", elevated

    # Admin passes the permission gate, then hits the explicit OS-update disable check.
    maintain.fail("nixpi-brokerctl nixos-update apply >/tmp/update.out 2>/tmp/update.err")
    maintain.succeed("grep -q 'OS updates are disabled' /tmp/update.err")

    maintain.succeed("nixpi-brokerctl revoke-admin >/tmp/revoke.json")
    revoked = json.loads(maintain.succeed("nixpi-brokerctl status"))
    assert revoked["effectiveAutonomy"] == "maintain", revoked

    print("NixPI broker autonomy test passed!")
  '';
}
