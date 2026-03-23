# NixOS Integration Tests for NixPI

This directory contains NixOS integration tests for the NixPI platform. These tests use the `pkgs.testers.runNixOSTest` framework to spin up QEMU VMs and verify that NixPI services work correctly together.

## Test Lanes

- `config`: fast non-VM closure build for the default installed system
- `nixos-smoke`: PR-oriented VM subset
  - `smoke-matrix`
  - `smoke-firstboot`
  - `smoke-security`
  - `smoke-broker`
- `nixos-full`: comprehensive VM lane
  - existing happy-path tests: `boot`, `nixpi-matrix`, `nixpi-firstboot`, `nixpi-network`, `nixpi-daemon`, `nixpi-e2e`, `nixpi-home`, `nixpi-security`, `nixpi-modular-services`, `nixpi-matrix-bridge`, `nixpi-matrix-reply`
  - new policy tests: `nixpi-bootstrap-mode`, `nixpi-post-setup-lockdown`, `nixpi-broker`
- `nixos-destructive`: slower install/lockdown/broker cases intended for manual or scheduled runs
  - `nixpi-installer-smoke`

## Running Tests

### Run fast local checks
```bash
nix build .#checks.x86_64-linux.config --no-link
nix build .#checks.x86_64-linux.nixos-smoke --no-link -L
```

### Run the full VM lane
```bash
nix build .#checks.x86_64-linux.nixos-full --no-link -L
```

### Run the destructive lane
```bash
nix build .#checks.x86_64-linux.nixos-destructive --no-link -L
nix build .#checks.x86_64-linux.nixpi-installer-smoke --no-link -L
```

### Run a specific test
```bash
nix build .#checks.x86_64-linux.nixpi-matrix --no-link -L
```

Equivalent `just` recipes:
```bash
just check-config
just check-nixos-smoke
just check-nixos-full
just check-nixos-destructive
just check-installer-smoke
```

### Interactive test driver
```bash
$(nix-build -A checks.x86_64-linux.nixpi-matrix.driverInteractive)/bin/nixos-test-driver
>>> nixpi.start()
>>> nixpi.shell_interact()
```

## Test Structure

```
tests/nixos/
├── lib.nix              # Shared test helpers and module lists
├── default.nix          # Test suite entry point
├── nixpi-bootstrap-mode.nix   # no-prefill bootstrap-state contract
├── nixpi-broker.nix           # broker autonomy and privilege boundaries
├── nixpi-post-setup-lockdown.nix # steady-state post-setup security contract
├── nixpi-matrix.nix           # Matrix homeserver test
├── nixpi-firstboot.nix        # First-boot wizard test
├── nixpi-network.nix          # Network/mesh test
├── nixpi-daemon.nix           # Pi daemon test
├── nixpi-e2e.nix              # End-to-end integration test
├── nixpi-home.nix             # NixPI Home and built-in system services test
├── nixpi-installer-smoke.nix  # live minimal manual installer smoke test
├── nixpi-modular-services.nix # system.services/configData regression
├── nixpi-matrix-bridge.nix    # multi-node Matrix daemon transport test
├── nixpi-matrix-reply.nix     # booted daemon can receive and answer Matrix messages
└── README.md            # This file
```

## Writing New Tests

When writing new NixOS tests:

1. **Don't set `nixpkgs.config` in test nodes** - The test framework injects its own `pkgs` and will reject `nixpkgs.config` settings. Use `pkgsUnfree` in `flake.nix` if you need unfree packages.

2. **Escape `''` in test scripts** - The Nix indented string syntax uses `''`. To include literal `''` in Python test scripts (e.g., for empty SSH passphrases), escape it as `''''`.

3. **Escape `${` in test scripts** - Nix interprets `${` as antiquotation. Escape it as `''${` inside indented strings.

4. **Use `nixPiModulesNoShell` when defining your own user** - The shell module defines the primary NixPI operator user from `nixpi.primaryUser`, so tests that define their own should use `nixPiModulesNoShell` instead of `nixPiModules`.

Example:
```nix
{ pkgs, lib, nixPiModulesNoShell, piAgent, appPackage, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "my-test";
  
  nodes.server = { ... }: {
    imports = nixPiModulesNoShell ++ [ mkTestFilesystems ];
    _module.args = { inherit piAgent appPackage; };
    
    nixpi.primaryUser = "pi";
    users.users.pi = { ... };
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

- `.github/workflows/check.yml` runs TypeScript checks plus `checks.x86_64-linux.config`
- `.github/workflows/nixos-vm.yml` runs VM lanes on a self-hosted runner

The VM workflow supports:
- `workflow_dispatch` with lane selection: `nixos-smoke`, `nixos-full`, `nixos-destructive`
- nightly scheduled `nixos-full`

To enable VM tests in CI:
1. Set up a self-hosted runner with KVM support
2. Ensure the runner can execute `nix build` with virtualization support
3. Optionally configure Cachix for faster builds

## Debugging Failed Tests

When a test fails, you can:

1. **Check the test log**: The `-L` flag shows full test output
   ```bash
   nix build .#checks.x86_64-linux.nixpi-matrix -L
   ```

2. **Run interactively**: Use the interactive driver to debug
   ```bash
   $(nix-build -A checks.x86_64-linux.nixpi-matrix.driverInteractive)/bin/nixos-test-driver
   >>> server.start()
   >>> server.execute("systemctl status nixpi-matrix")
   >>> server.shell_interact()  # Get a shell
   ```

3. **Check VM logs**: Tests capture systemd journal output which is printed on failure

## References

- [NixOS Test Driver Documentation](https://nixos.org/manual/nixos/stable/#sec-nixos-tests)
- [NixOS Testing Infrastructure](https://nixos.wiki/wiki/NixOS_Testing_infrastructure)
- [Integration testing with NixOS virtual machines](https://nix.dev/tutorials/integration-testing-using-virtual-machines.html)
