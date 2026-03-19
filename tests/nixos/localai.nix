# tests/nixos/localai.nix
# Test that the LocalAI inference service (llama-server) starts correctly
# Note: Uses a tiny test model instead of the full 5GB model

{ pkgs, lib, workspaceModules, workspaceModulesNoShell, piAgent, appPackage, mkWorkspaceNode, mkTestFilesystems }:

let
  # Tiny test model for CI/tests (SmolLM 135M - ~270MB)
  # This is much faster to download than the 5GB OmniCoder model
  testModelUrl = "https://huggingface.co/HuggingFaceTB/SmolLM-135M-GGUF/resolve/main/smollm-135m.q4_k_m.gguf";
  testModelName = "smollm-135m.q4_k_m.gguf";
in
pkgs.testers.runNixOSTest {
  name = "localai";

  nodes.server = { ... }: {
    imports = workspaceModules ++ [ mkTestFilesystems ];
    _module.args = { inherit piAgent appPackage; };

    # VM configuration
    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;

    # Standard system config
    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = "localai-test";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
    # nixpkgs.config NOT set here - test framework injects its own pkgs

    # Override the model download service to use a tiny test model
    systemd.services.localai-download = {
      serviceConfig.ExecStart = lib.mkForce (pkgs.writeShellScript "localai-download-test" ''
        dest=/var/lib/localai/models/''${testModelName}
        if [ -f "$dest" ]; then
          echo "''${testModelName} already present — skipping download"
          exit 0
        fi
        echo "Downloading ''${testModelName} (~270 MB) for testing..."
        ''${pkgs.curl}/bin/curl -L --retry 3 --retry-delay 5 \
          --progress-bar -o "$dest.tmp" "''${testModelUrl}"
        mv "$dest.tmp" "$dest"
        echo "Download complete: $dest"
      '');
    };

    # Override llama-server to use the test model
    systemd.services.localai = {
      serviceConfig.ExecStart = lib.mkForce "${pkgs.llama-cpp}/bin/llama-server --host 0.0.0.0 --port 11435 --model /var/lib/localai/models/${testModelName} --ctx-size 512";
    };
  };

  testScript = { nodes, ... }: ''
    # Start the server
    server.start()
    
    # Wait for basic system to be up
    server.wait_for_unit("multi-user.target", timeout=300)
    
    # Wait for network to be online
    server.wait_for_unit("network-online.target", timeout=60)
    
    # Test 1: Model download service completes (or model already exists)
    # This may take a while on first run due to download
    server.wait_for_unit("localai-download.service", timeout=300)
    
    # Test 2: Model file exists
    server.succeed("test -f /var/lib/localai/models/${testModelName}")
    
    # Test 3: llama-server service starts
    server.wait_for_unit("localai.service", timeout=60)
    
    # Test 4: Server responds to health/ready check
    server.wait_until_succeeds("curl -sf http://localhost:11435/health", timeout=60)
    
    # Test 5: Server responds to completion endpoint
    server.succeed("curl -sf http://localhost:11435/v1/models")
    
    # Test 6: Can make a simple completion request
    completion_result = server.succeed("""
      curl -sf -X POST http://localhost:11435/v1/chat/completions \
        -H "Content-Type: application/json" \
        -d '{"messages":[{"role":"user","content":"Hello"}],"max_tokens":10}'
    """)
    assert "completion" in completion_result.lower() or "message" in completion_result.lower(), \
        "Unexpected completion response: " + completion_result
    
    # Test 7: Service is in wantedBy multi-user.target
    server.succeed("systemctl list-dependencies multi-user.target | grep -q localai")
    
    # Test 8: localai user exists
    server.succeed("id localai")
    
    # Test 9: Model directory has correct permissions
    server.succeed("test -d /var/lib/localai/models")
    perms = server.succeed("stat -c '%U:%G' /var/lib/localai/models").strip()
    assert "localai" in perms, "Unexpected model directory ownership: " + perms
    
    # Test 10: Service restart works
    server.succeed("systemctl restart localai.service")
    server.wait_for_unit("localai.service", timeout=60)
    server.wait_until_succeeds("curl -sf http://localhost:11435/health", timeout=30)
    
    print("All localai tests passed!")
  '';
}
