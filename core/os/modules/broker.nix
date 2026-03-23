{ config, lib, pkgs, ... }:

let
  resolved = import ../lib/resolve-primary-user.nix { inherit lib config; };
  primaryUser = resolved.resolvedPrimaryUser;
  stateDir = config.nixpi.stateDir;
  socketDir = "/run/nixpi-broker";
  socketPath = "${socketDir}/broker.sock";
  brokerStateDir = "${stateDir}/broker";
  elevationPath = "${brokerStateDir}/elevation.json";

  brokerConfig = pkgs.writeText "nixpi-broker-config.json" (builtins.toJSON {
    inherit socketPath elevationPath brokerStateDir primaryUser;
    defaultAutonomy = config.nixpi.agent.autonomy;
    elevationDuration = config.nixpi.agent.elevation.duration;
    osUpdateEnable = config.nixpi.agent.osUpdate.enable;
    allowedUnits = config.nixpi.agent.allowedUnits;
    defaultFlake = "${resolved.resolvedPrimaryHome}/nixpi";
  });

  brokerProgram = pkgs.writeScriptBin "nixpi-broker" ''
    #!${pkgs.python3}/bin/python3
    import grp
    import json
    import os
    import socket
    import subprocess
    import sys
    import time

    CONFIG = json.load(open(os.environ["NIXPI_BROKER_CONFIG"], "r", encoding="utf-8"))

    def load_elevation():
        try:
            with open(CONFIG["elevationPath"], "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError:
            return None
        except Exception:
            return None
        until = data.get("until")
        if not isinstance(until, (int, float)):
            return None
        if until <= time.time():
            try:
                os.unlink(CONFIG["elevationPath"])
            except FileNotFoundError:
                pass
            return None
        return data

    def current_autonomy():
        if CONFIG["defaultAutonomy"] == "admin":
            return "admin"
        if load_elevation():
            return "admin"
        return CONFIG["defaultAutonomy"]

    def ensure_allowed_level(required):
        levels = {"observe": 0, "maintain": 1, "admin": 2}
        if levels[current_autonomy()] < levels[required]:
            raise PermissionError(f"operation requires {required} autonomy")

    def run_command(args):
        proc = subprocess.run(args, capture_output=True, text=True)
        return {
            "ok": proc.returncode == 0,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "exitCode": proc.returncode,
        }

    def handle_request(req):
        op = req.get("operation")
        if op == "systemd":
            action = req.get("action")
            unit = req.get("unit")
            if not isinstance(unit, str) or unit not in CONFIG["allowedUnits"]:
                raise PermissionError(f"unit not allowed: {unit}")
            if action == "status":
                ensure_allowed_level("observe")
                return run_command(["systemctl", "status", "--no-pager", unit])
            if action in ("start", "stop", "restart", "enable-now"):
                ensure_allowed_level("maintain")
                if action == "enable-now":
                    return run_command(["systemctl", "enable", "--now", unit])
                return run_command(["systemctl", action, unit])
            raise ValueError(f"unsupported systemd action: {action}")
        if op == "nixos-update":
            ensure_allowed_level("admin")
            if not CONFIG["osUpdateEnable"]:
                raise PermissionError("OS updates are disabled")
            action = req.get("action")
            if action == "rollback":
                return run_command(["nixos-rebuild", "switch", "--rollback"])
            if action == "apply":
                flake = req.get("flake") or CONFIG["defaultFlake"]
                return run_command(["nixos-rebuild", "switch", "--flake", flake])
            raise ValueError(f"unsupported nixos-update action: {action}")
        if op == "schedule-reboot":
            ensure_allowed_level("admin")
            delay = int(req.get("minutes", 1))
            delay = max(1, min(delay, 7 * 24 * 60))
            return run_command(["systemd-run", f"--on-active={delay}m", "systemctl", "reboot"])
        raise ValueError(f"unsupported operation: {op}")

    def reply(conn, payload):
        conn.sendall((json.dumps(payload) + "\n").encode("utf-8"))

    def serve():
        os.makedirs(os.path.dirname(CONFIG["socketPath"]), exist_ok=True)
        os.makedirs(CONFIG["brokerStateDir"], exist_ok=True)
        try:
            os.unlink(CONFIG["socketPath"])
        except FileNotFoundError:
            pass
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(CONFIG["socketPath"])
        gid = grp.getgrnam(CONFIG["primaryUser"]).gr_gid
        os.chown(CONFIG["socketPath"], 0, gid)
        os.chmod(CONFIG["socketPath"], 0o660)
        srv.listen(32)
        while True:
            conn, _ = srv.accept()
            with conn:
                data = b""
                while not data.endswith(b"\n"):
                    chunk = conn.recv(65536)
                    if not chunk:
                        break
                    data += chunk
                try:
                    req = json.loads(data.decode("utf-8").strip() or "{}")
                    resp = handle_request(req)
                except PermissionError as exc:
                    resp = {"ok": False, "stdout": "", "stderr": str(exc), "exitCode": 126}
                except Exception as exc:
                    resp = {"ok": False, "stdout": "", "stderr": str(exc), "exitCode": 1}
                reply(conn, resp)

    def parse_duration(spec):
        if spec.endswith("m"):
            return int(spec[:-1]) * 60
        if spec.endswith("h"):
            return int(spec[:-1]) * 3600
        return int(spec) * 60

    def request(payload):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(CONFIG["socketPath"])
        with sock:
            sock.sendall((json.dumps(payload) + "\n").encode("utf-8"))
            data = b""
            while not data.endswith(b"\n"):
                chunk = sock.recv(65536)
                if not chunk:
                    break
                data += chunk
        resp = json.loads(data.decode("utf-8").strip() or "{}")
        sys.stdout.write(resp.get("stdout", ""))
        if resp.get("stderr"):
            sys.stderr.write(resp["stderr"])
        return int(resp.get("exitCode", 1))

    def main(argv):
        if len(argv) < 2:
            print("usage: nixpi-broker <server|status|grant-admin|revoke-admin|systemd|nixos-update|schedule-reboot>", file=sys.stderr)
            return 1
        cmd = argv[1]
        if cmd == "server":
            serve()
            return 0
        if cmd == "status":
            data = load_elevation()
            print(json.dumps({
                "defaultAutonomy": CONFIG["defaultAutonomy"],
                "effectiveAutonomy": current_autonomy(),
                "elevatedUntil": data.get("until") if data else None,
            }))
            return 0
        if cmd == "grant-admin":
            duration = argv[2] if len(argv) > 2 else CONFIG["elevationDuration"]
            os.makedirs(CONFIG["brokerStateDir"], exist_ok=True)
            until = int(time.time()) + parse_duration(duration)
            with open(CONFIG["elevationPath"], "w", encoding="utf-8") as fh:
                json.dump({"until": until, "grantedAt": int(time.time())}, fh)
            print(json.dumps({"effectiveAutonomy": "admin", "until": until}))
            return 0
        if cmd == "revoke-admin":
            try:
                os.unlink(CONFIG["elevationPath"])
            except FileNotFoundError:
                pass
            print(json.dumps({"effectiveAutonomy": CONFIG["defaultAutonomy"]}))
            return 0
        if cmd == "systemd":
            if len(argv) != 4:
                print("usage: nixpi-broker systemd <status|start|stop|restart|enable-now> <unit>", file=sys.stderr)
                return 1
            return request({"operation": "systemd", "action": argv[2], "unit": argv[3]})
        if cmd == "nixos-update":
            if len(argv) < 3:
                print("usage: nixpi-broker nixos-update <apply|rollback> [flake]", file=sys.stderr)
                return 1
            payload = {"operation": "nixos-update", "action": argv[2]}
            if len(argv) > 3:
                payload["flake"] = argv[3]
            return request(payload)
        if cmd == "schedule-reboot":
            if len(argv) != 3:
                print("usage: nixpi-broker schedule-reboot <minutes>", file=sys.stderr)
                return 1
            return request({"operation": "schedule-reboot", "minutes": int(argv[2])})
        print(f"unknown command: {cmd}", file=sys.stderr)
        return 1

    raise SystemExit(main(sys.argv))
  '';

  brokerCtl = pkgs.writeShellScriptBin "nixpi-brokerctl" ''
    export NIXPI_BROKER_CONFIG=${brokerConfig}
    exec ${brokerProgram}/bin/nixpi-broker "$@"
  '';
in
{
  imports = [ ./options.nix ];

  config = lib.mkIf config.nixpi.agent.broker.enable {
    assertions = [
    {
      assertion = config.nixpi.agent.autonomy != "";
      message = "nixpi.agent.autonomy must not be empty.";
    }
    {
      assertion = config.nixpi.agent.elevation.duration != "";
      message = "nixpi.agent.elevation.duration must not be empty.";
    }
  ];

    environment.systemPackages = [ brokerCtl ];

    systemd.tmpfiles.rules = [
      "d ${brokerStateDir} 0770 root ${primaryUser} -"
    ];

    system.services.nixpi-broker = {
      imports = [ ../services/nixpi-broker.nix ];
      nixpi-broker = {
        command = "${brokerCtl}/bin/nixpi-brokerctl";
        inherit brokerConfig stateDir;
      };
    };

    security.sudo.extraRules =
      lib.optional (primaryUser != "") {
        users = [ primaryUser ];
        commands = [
          { command = "${brokerCtl}/bin/nixpi-brokerctl grant-admin *"; options = [ "NOPASSWD" ]; }
          { command = "${brokerCtl}/bin/nixpi-brokerctl revoke-admin"; options = [ "NOPASSWD" ]; }
          { command = "${brokerCtl}/bin/nixpi-brokerctl status"; options = [ "NOPASSWD" ]; }
        ];
      };
  };
}
