{ lib, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkTestFilesystems, matrixRegisterScript, ... }:

{
  name = "nixpi-matrix-reply";

  nodes = {
    homeserver = { ... }: let
      username = "homeserver";
      homeDir = "/home/${username}";
    in {
      imports = nixPiModulesNoShell ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage setupPackage; };
      nixpi.primaryUser = username;
      nixpi.security.trustedInterface = "eth1";

      networking.hostName = "nixpi";

      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" ];
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = {};

      environment.systemPackages = [ pkgs.curl pkgs.jq ];

      systemd.services.netbird.wantedBy = lib.mkForce [ ];
      systemd.services.nixpi-home.wantedBy = lib.mkForce [ ];
      systemd.services.nixpi-element-web.wantedBy = lib.mkForce [ ];
      systemd.timers.nixpi-update.wantedBy = lib.mkForce [ ];
    };

    nixpi = { ... }: let
      username = "pi";
      homeDir = "/home/${username}";
      testProviderDir = "${homeDir}/nixpi/test-provider";
    in {
      imports = nixPiModulesNoShell ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage setupPackage; };
      nixpi.primaryUser = username;

      networking.hostName = "nixpi-agent";

      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" ];
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = {};

      environment.systemPackages = [ pkgs.curl pkgs.jq ];

      systemd.services.continuwuity.wantedBy = lib.mkForce [ ];
      systemd.services.netbird.wantedBy = lib.mkForce [ ];
      systemd.services.nixpi-home.wantedBy = lib.mkForce [ ];
      systemd.services.nixpi-element-web.wantedBy = lib.mkForce [ ];
      systemd.timers.nixpi-update.wantedBy = lib.mkForce [ ];

      system.activationScripts.nixpi-matrix-reply-fixtures = lib.stringAfter [ "users" ] ''
        install -d -m 0755 -o ${username} -g ${username} ${homeDir}/.nixpi
        install -d -m 0700 -o ${username} -g ${username} ${homeDir}/.pi
        install -d -m 0775 -o ${username} -g ${username} ${homeDir}/nixpi
        install -d -m 0775 -o ${username} -g ${username} ${homeDir}/nixpi/Agents
        install -d -m 0775 -o ${username} -g ${username} ${homeDir}/nixpi/Agents/host
        install -d -m 0755 -o ${username} -g ${username} ${testProviderDir}
        install -d -m 0700 -o ${username} -g ${username} ${homeDir}/.pi/matrix-agents

        cat > ${homeDir}/nixpi/Agents/host/AGENTS.md <<'EOF'
---
id: host
name: Pi
matrix:
  username: host
  autojoin: true
respond:
  mode: host
---
You are Pi.
EOF

        cat > ${testProviderDir}/package.json <<'EOF'
{
  "name": "nixpi-test-provider",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "pi": {
    "extensions": [
      "./index.js"
    ]
  }
}
EOF

        cat > ${testProviderDir}/index.js <<'EOF'
import { createAssistantMessageEventStream } from "/usr/local/share/nixpi/node_modules/@mariozechner/pi-ai/dist/index.js";

export default function registerTestProvider(pi) {
  pi.registerProvider("matrix-echo", {
    api: "matrix-echo-api",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "test-key",
    models: [
      {
        id: "echo-v1",
        name: "Matrix Echo v1",
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 256
      }
    ],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const reply = "PI-ECHO-ACK";
        const message = {
          role: "assistant",
          content: [{ type: "text", text: reply }],
          api: "matrix-echo-api",
          provider: "matrix-echo",
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          },
          stopReason: "stop",
          timestamp: Date.now()
        };
        stream.push({ type: "start", partial: message });
        stream.push({ type: "text_start", contentIndex: 0, partial: message });
        stream.push({ type: "text_delta", contentIndex: 0, delta: reply, partial: message });
        stream.push({ type: "text_end", contentIndex: 0, content: reply, partial: message });
        stream.push({ type: "done", reason: "stop", message });
      });
      return stream;
    }
  });
}
EOF

        cat > ${homeDir}/.pi/settings.json <<'EOF'
{
  "packages": [
    "/usr/local/share/nixpi",
    "${testProviderDir}"
  ],
  "defaultProvider": "matrix-echo",
  "defaultModel": "echo-v1"
}
EOF

        install -d -m 0755 -o ${username} -g ${username} ${homeDir}/.nixpi/wizard-state
        touch ${homeDir}/.nixpi/wizard-state/system-ready
        chown -R ${username}:${username} ${homeDir}/.nixpi ${homeDir}/.pi ${homeDir}/nixpi
        chmod 600 ${homeDir}/.pi/settings.json
      '';
    };
  };

  testScript = ''
    import urllib.parse

    ${matrixRegisterScript}

    homeserver = machines[0]
    nixpi = machines[1]

    start_all()

    homeserver.wait_for_unit("continuwuity.service", timeout=120)
    homeserver.wait_until_succeeds("curl -sf http://127.0.0.1:6167/_matrix/client/versions", timeout=60)
    registration_token = homeserver.succeed("cat /var/lib/nixpi/secrets/matrix-registration-shared-secret").strip()
    host_creds = register_matrix_user(homeserver, "http://127.0.0.1:6167", "host", "hostpass123", registration_token)
    admin_creds = register_matrix_user(homeserver, "http://127.0.0.1:6167", "operator", "operatorpass123", registration_token)

    room = json.loads(homeserver.succeed(
        "curl -sf -X POST http://127.0.0.1:6167/_matrix/client/v3/createRoom "
        + "-H 'Authorization: Bearer " + admin_creds["access_token"] + "' "
        + "-H 'Content-Type: application/json' "
        + "-d '{"
        + "\"preset\":\"public_chat\","
        + "\"room_alias_name\":\"general\","
        + "\"invite\":[\"@host:nixpi\"]"
        + "}'"
    ))
    room_id = room["room_id"]
    room_id_enc = urllib.parse.quote(room_id, safe="")

    nixpi.succeed(
        "cat > /home/pi/.pi/matrix-credentials.json <<'EOF'\n"
        + json.dumps({
            "homeserver": "http://nixpi:6167",
            "botUserId": host_creds["user_id"],
            "botAccessToken": host_creds["access_token"],
            "botPassword": "hostpass123",
        }, indent=2)
        + "\nEOF"
    )
    nixpi.succeed("chown pi:pi /home/pi/.pi/matrix-credentials.json")
    nixpi.succeed("chmod 600 /home/pi/.pi/matrix-credentials.json")

    nixpi.succeed(
        "cat > /home/pi/.pi/matrix-agents/host.json <<'EOF'\n"
        + json.dumps({
            "homeserver": "http://nixpi:6167",
            "userId": host_creds["user_id"],
            "accessToken": host_creds["access_token"],
            "password": "hostpass123",
            "username": "host",
        }, indent=2)
        + "\nEOF"
    )
    nixpi.succeed("chown pi:pi /home/pi/.pi/matrix-agents/host.json")
    nixpi.succeed("chmod 600 /home/pi/.pi/matrix-agents/host.json")

    nixpi.succeed("systemctl restart nixpi-daemon.service")
    nixpi.wait_until_succeeds(
        "systemctl is-active nixpi-daemon.service | grep -Eq 'active|activating'",
        timeout=60,
    )
    nixpi.succeed(
        "systemctl show -p Environment --value nixpi-daemon.service | grep -q 'PI_CODING_AGENT_DIR=/home/pi/.pi'"
    )

    homeserver.wait_until_succeeds(
        "curl -sf http://127.0.0.1:6167/_matrix/client/v3/rooms/"
        + room_id_enc
        + "/members -H 'Authorization: Bearer "
        + admin_creds["access_token"]
        + "' | grep -q '\"membership\":\"join\"' && "
        + "curl -sf http://127.0.0.1:6167/_matrix/client/v3/rooms/"
        + room_id_enc
        + "/members -H 'Authorization: Bearer "
        + admin_creds["access_token"]
        + "' | grep -q '@host:nixpi'",
        timeout=60,
    )

    homeserver.succeed(
        "curl -sf -X PUT http://127.0.0.1:6167/_matrix/client/v3/rooms/"
        + room_id_enc
        + "/send/m.room.message/reply-test "
        + "-H 'Authorization: Bearer "
        + admin_creds["access_token"]
        + "' "
        + "-H 'Content-Type: application/json' "
        + "-d '{\"msgtype\":\"m.text\",\"body\":\"hello from reply test\"}'"
    )

    homeserver.wait_until_succeeds(
        "curl -sf 'http://127.0.0.1:6167/_matrix/client/v3/rooms/"
        + room_id_enc
        + "/messages?dir=b&limit=20' -H 'Authorization: Bearer "
        + admin_creds["access_token"]
        + "' | grep -q 'PI-ECHO-ACK'",
        timeout=60,
    )
    nixpi.succeed("journalctl -u nixpi-daemon.service --no-pager | grep -q 'starting nixpi-daemon'")
    nixpi.fail("journalctl -u nixpi-daemon.service --no-pager | grep -q 'No model selected'")

    print("NixPI matrix reply test passed!")
  '';
}
