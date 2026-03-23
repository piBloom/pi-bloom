# tests/nixos/lib.nix
# Shared helpers for NixPI NixOS integration tests

{ pkgs, lib, self }:

{
  mkBaseNode = extraConfig: {
    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;
    virtualisation.graphics = false;

    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = lib.mkDefault "nixos";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
  } // extraConfig;

  mkManagedUserConfig = {
    username,
    homeDir ? "/home/${username}",
    extraGroups ? [ "wheel" "networkmanager" ],
  }: {
    nixpi.primaryUser = username;

    users.users.${username} = {
      isNormalUser = true;
      group = username;
      inherit extraGroups;
      home = homeDir;
      shell = pkgs.bash;
    };
    users.groups.${username} = {};
  };

  mkPrefillActivation = {
    username,
    homeDir ? "/home/${username}",
    matrixUsername ? "testuser",
    matrixPassword ? "testpassword123",
  }: lib.stringAfter [ "users" ] ''
    mkdir -p ${homeDir}/.nixpi
    cat > ${homeDir}/.nixpi/prefill.env << 'EOF'
PREFILL_USERNAME=${matrixUsername}
PREFILL_MATRIX_PASSWORD=${matrixPassword}
EOF
    chown -R ${username}:${username} ${homeDir}/.nixpi
    chmod 755 ${homeDir}/.nixpi
    chmod 644 ${homeDir}/.nixpi/prefill.env
  '';

  mkMatrixAdminSeedConfig = {
    username,
    password,
  }: {
    services.matrix-continuwuity.settings.admin_execute = [
      "users create-user ${username} ${password}"
    ];
  };

  # Minimal filesystem configuration for test VMs
  mkTestFilesystems = {
    fileSystems."/" = { device = "/dev/vda"; fsType = "ext4"; };
    fileSystems."/boot" = { device = "/dev/vda1"; fsType = "vfat"; };
  };

  # Reuse the flake's exported module composition so tests stay aligned with
  # the real desktop/consumer entrypoint.
  nixPiModules = [
    self.nixosModules.nixpi
  ];

  # NixPI modules without nixpi-shell (for tests that define their own operator user)
  nixPiModulesNoShell = [
    self.nixosModules.nixpi-no-shell
  ];

  matrixTestClient = pkgs.writers.writePython3Bin "nixpi-matrix-client" {
    libraries = with pkgs.python3Packages; [ matrix-nio ];
    flakeIgnore = [ "E501" ];
  } ''
    import asyncio
    import json
    import sys

    from nio import AsyncClient, JoinResponse, RoomMessageText


    async def ensure_registered(client, username, password):
        response = await client.register(username, password)
        if hasattr(response, "access_token"):
            return response
        session = getattr(response, "session", None)
        if not session:
            raise RuntimeError(f"register failed: {response}")
        response = await client.register(
            username,
            password,
            auth={"type": "m.login.dummy", "session": session},
        )
        if not hasattr(response, "access_token"):
            raise RuntimeError(f"dummy auth register failed: {response}")
        return response


    async def main():
        homeserver, username, password, room_alias, outbound, expected = sys.argv[1:7]
        client = AsyncClient(homeserver)
        response = await ensure_registered(client, username, password)
        client.access_token = response.access_token
        client.user_id = response.user_id

        join = await client.join(room_alias)
        if not isinstance(join, JoinResponse):
            raise RuntimeError(f"join failed: {join}")
        room_id = join.room_id

        got_expected = False

        async def on_message(_room, event):
            nonlocal got_expected
            if isinstance(event, RoomMessageText) and expected in event.body:
                got_expected = True
                await client.close()

        client.add_event_callback(on_message, RoomMessageText)
        await client.room_send(
            room_id=room_id,
            message_type="m.room.message",
            content={"msgtype": "m.text", "body": outbound},
        )

        if expected == "-":
            print(json.dumps({"room_id": room_id, "user_id": client.user_id}))
            await client.close()
            return

        for _ in range(30):
            await client.sync(timeout=1000)
            if got_expected:
                print(json.dumps({"room_id": room_id, "user_id": client.user_id}))
                return

        raise RuntimeError("timed out waiting for expected reply")

    asyncio.run(main())
  '';

  # Test utilities package
  testUtils = pkgs.writeShellScriptBin "nixpi-test-utils" ''
    # Wait for a systemd unit to be active on the system bus
    wait_for_unit_active() {
      local unit="$1"
      local timeout="''${2:-30}"
      local elapsed=0
      
      while ! systemctl is-active "$unit" 2>/dev/null | grep -q active; do
        sleep 1
        elapsed=$((elapsed + 1))
        if [ "$elapsed" -ge "$timeout" ]; then
          echo "Timeout waiting for unit $unit"
          return 1
        fi
      done
    }
    
    # Register a Matrix user on the local Continuwuity instance
    register_matrix_user() {
      local username="$1"
      local password="$2"
      local homeserver="''${3:-http://localhost:6167}"
      local token="''${4:-}"
      if [ -z "$token" ]; then
        token=$(get_matrix_token)
      fi

      local result
      result=$(curl -s -X POST "''${homeserver}/_matrix/client/v3/register" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"password\":\"$password\",\"inhibit_login\":false}")

      if echo "$result" | grep -q '"access_token"'; then
        echo "$result"
        return 0
      fi

      local attempt session auth_payload
      for attempt in 1 2 3 4; do
        session=$(jq -r '.session // empty' <<< "$result")
        if [ -z "$session" ]; then
          break
        fi

        auth_payload=$(
          jq -c \
            --arg session "$session" \
            --arg token "$token" \
            '
            def completed: (.completed // []);
            first(
              (.flows // [])[]?.stages[]? as $stage
              | select((completed | index($stage)) | not)
              | if $stage == "m.login.registration_token" and ($token | length) > 0 then
                  { type: $stage, session: $session, token: $token }
                elif $stage == "m.login.dummy" then
                  { type: $stage, session: $session }
                else
                  empty
                end
            ) // (
              if ((completed | index("m.login.registration_token")) | not) and ($token | length) > 0 then
                { type: "m.login.registration_token", session: $session, token: $token }
              elif ((completed | index("m.login.dummy")) | not) then
                { type: "m.login.dummy", session: $session }
              else
                empty
              end
            )
            ' <<< "$result"
        )

        if [ -z "$auth_payload" ] || [ "$auth_payload" = "null" ]; then
          break
        fi

        result=$(jq -cn \
          --arg username "$username" \
          --arg password "$password" \
          --argjson auth "$auth_payload" \
          '{ username: $username, password: $password, inhibit_login: false, auth: $auth }' \
          | curl -sf -X POST "''${homeserver}/_matrix/client/v3/register" \
              -H "Content-Type: application/json" \
              -d @-)

        if echo "$result" | grep -q '"access_token"'; then
          echo "$result"
          return 0
        fi
      done

      printf '%s\n' "$result" >&2
      return 1
    }
    
    # Get Matrix registration token from file
    get_matrix_token() {
      local token_file="/var/lib/nixpi/secrets/matrix-registration-shared-secret"
      if [ -f "$token_file" ]; then
        cat "$token_file"
      else
        echo ""
      fi
    }
    
    # Check if Matrix homeserver is ready
    matrix_ready() {
      local homeserver="''${1:-http://localhost:6167}"
      curl -sf "''${homeserver}/_matrix/client/versions" >/dev/null 2>&1
    }
    
    # Wait for Matrix homeserver to be ready
    wait_for_matrix() {
      local homeserver="''${1:-http://localhost:6167}"
      local timeout="''${2:-60}"
      local elapsed=0
      
      while ! matrix_ready "$homeserver"; do
        sleep 1
        elapsed=$((elapsed + 1))
        if [ "$elapsed" -ge "$timeout" ]; then
          echo "Timeout waiting for Matrix homeserver"
          return 1
        fi
      done
    }
  '';

  matrixRegisterScript = ''
    import json

    def register_matrix_user(machine, homeserver, username, password, token=""):
        if not token:
            token = machine.succeed("get_matrix_token").strip()
        response = machine.succeed(
            "curl -s -X POST " + homeserver + "/_matrix/client/v3/register "
            + "-H 'Content-Type: application/json' "
            + "-d '{\"username\":\"" + username + "\",\"password\":\"" + password + "\",\"inhibit_login\":false}'"
        )
        data = json.loads(response)
        if "access_token" in data:
            return data
        for _ in range(4):
            session = data.get("session")
            assert session, "Matrix registration challenge missing session: " + response

            completed = set(data.get("completed", []))
            auth = None
            for flow in data.get("flows", []):
                for stage in flow.get("stages", []):
                    if stage in completed:
                        continue
                    if stage == "m.login.registration_token" and token:
                        auth = {"type": stage, "session": session, "token": token}
                        break
                    if stage == "m.login.dummy":
                        auth = {"type": stage, "session": session}
                        break
                if auth:
                    break
            if not auth and token and "m.login.registration_token" not in completed:
                auth = {"type": "m.login.registration_token", "session": session, "token": token}
            if not auth and "m.login.dummy" not in completed:
                auth = {"type": "m.login.dummy", "session": session}
            assert auth, "Matrix registration challenge advertised no supported auth stages: " + response

            payload = json.dumps({
                "username": username,
                "password": password,
                "inhibit_login": False,
                "auth": auth,
            })
            response = machine.succeed(
                "curl -sf -X POST " + homeserver + "/_matrix/client/v3/register "
                + "-H 'Content-Type: application/json' "
                + "-d '" + payload + "'"
            )
            data = json.loads(response)
            if "access_token" in data:
                return data

        raise AssertionError("Matrix registration did not complete: " + response)

    def login_matrix_user(machine, homeserver, username, password):
        payload = json.dumps({
            "type": "m.login.password",
            "identifier": {
                "type": "m.id.user",
                "user": username,
            },
            "password": password,
        })
        response = machine.succeed(
            "curl -sf -X POST " + homeserver + "/_matrix/client/v3/login "
            + "-H 'Content-Type: application/json' "
            + "-d '" + payload + "'"
        )
        return json.loads(response)
  '';
}
