# NixOS Integration Tests for Bloom OS

This directory contains NixOS integration tests for the Bloom OS platform. These tests use the `pkgs.testers.runNixOSTest` framework to spin up QEMU VMs and verify that Bloom services work correctly together.

## Test Suite

| Test | Description | Duration | Nodes |
|------|-------------|----------|-------|
| `bloom-config` | Fast build test of the default installed system closure | ~1 min | None |
| `bloom-boot` | Basic VM boot and service startup test | ~3 min | 1 |
| `bloom-matrix` | Matrix homeserver (Conduwuity) functionality | ~3 min | 1 |
| `bloom-firstboot` | First-boot preparation and unattended prefill automation | ~5 min | 1 |
| `bloom-localai` | LocalAI inference service with test model | ~10 min | 1 |
| `bloom-network` | Network connectivity and SSH between nodes | ~5 min | 2 |
| `bloom-daemon` | Pi daemon Matrix agent connection | ~5 min | 2 |
| `bloom-e2e` | Full end-to-end integration test | ~10 min | 2 |
| `bloom-home` | Bloom Home plus built-in user web services | ~5 min | 1 |

## Running Tests

### Run all tests
```bash
nix flake check
```

### Run a specific test
```bash
nix build .#checks.x86_64-linux.bloom-matrix --no-link -L
```

### Interactive test driver
```bash
$(nix-build -A checks.x86_64-linux.bloom-matrix.driverInteractive)/bin/nixos-test-driver
>>> bloom.start()
>>> bloom.shell_interact()
```

## Test Structure

```
tests/nixos/
├── lib.nix              # Shared test helpers and module lists
├── default.nix          # Test suite entry point
├── bloom-matrix.nix     # Matrix homeserver test
├── bloom-firstboot.nix  # First-boot wizard test
├── bloom-localai.nix    # LocalAI inference test
├── bloom-network.nix    # Network/mesh test
├── bloom-daemon.nix     # Pi daemon test
├── bloom-e2e.nix        # End-to-end integration test
├── bloom-home.nix       # Bloom Home and built-in user services test
└── README.md            # This file
```

## Writing New Tests

When writing new NixOS tests:

1. **Don't set `nixpkgs.config` in test nodes** - The test framework injects its own `pkgs` and will reject `nixpkgs.config` settings. Use `pkgsUnfree` in `flake.nix` if you need unfree packages.

2. **Escape `''` in test scripts** - The Nix indented string syntax uses `''`. To include literal `''` in Python test scripts (e.g., for empty SSH passphrases), escape it as `''''`.

3. **Escape `${` in test scripts** - Nix interprets `${` as antiquotation. Escape it as `''${` inside indented strings.

4. **Use `bloomModulesNoShell` when defining your own user** - The `bloom-shell.nix` module defines the primary Bloom user from `bloom.username`, so tests that define their own should use `bloomModulesNoShell` instead of `bloomModules`.

Example:
```nix
{ pkgs, lib, bloomModulesNoShell, piAgent, bloomApp, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "my-test";
  
  nodes.server = { ... }: {
    imports = bloomModulesNoShell ++ [ mkTestFilesystems ];
    _module.args = { inherit piAgent bloomApp; };
    
    bloom.username = "bloom";
    users.users.bloom = { ... };
  };
  
  testScript = ''
    server.start()
    server.wait_for_unit("multi-user.target")
    
    # Escape '' in shell commands
    server.succeed("ssh-keygen -N '''' -f /root/.ssh/id_rsa")
    
    # Use string concatenation instead of f-strings with ${}
    msg = "Hello " + name
  '';
}
```

## CI Integration

The NixOS tests run in CI via `.github/workflows/nixos-tests.yml`:

- **Fast checks** (`bloom-config`) run on every PR
- **VM tests** require KVM and run on self-hosted runners or can be triggered manually
- Tests are skipped if KVM is not available

To enable full VM tests in CI:
1. Set up a self-hosted runner with KVM support
2. Set the `NIXOS_TEST_RUNNER` repository variable to the runner label
3. Optionally configure Cachix for faster builds

## Debugging Failed Tests

When a test fails, you can:

1. **Check the test log**: The `-L` flag shows full test output
   ```bash
   nix build .#checks.x86_64-linux.bloom-matrix -L
   ```

2. **Run interactively**: Use the interactive driver to debug
   ```bash
   $(nix-build -A checks.x86_64-linux.bloom-matrix.driverInteractive)/bin/nixos-test-driver
   >>> server.start()
   >>> server.execute("systemctl status bloom-matrix")
   >>> server.shell_interact()  # Get a shell
   ```

3. **Check VM logs**: Tests capture systemd journal output which is printed on failure

## References

- [NixOS Test Driver Documentation](https://nixos.org/manual/nixos/stable/#sec-nixos-tests)
- [NixOS Testing Infrastructure](https://nixos.wiki/wiki/NixOS_Testing_infrastructure)
- [Integration testing with NixOS virtual machines](https://nix.dev/tutorials/integration-testing-using-virtual-machines.html)
