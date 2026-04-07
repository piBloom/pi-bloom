# NixOS Integration Tests for NixPI

This directory contains NixOS integration tests for the NixPI platform. These tests use the `pkgs.testers.runNixOSTest` framework to spin up QEMU VMs and verify that NixPI services work correctly together.

## Test Lanes

- `config`: fast non-VM closure build for the default headless VPS system
- `config-stable-bootstrap`: fast non-VM closure build for the documented stable bootstrap target
- `vps-topology`: fast flake-shape check for the canonical `vps` host profile
- `nixos-smoke`: PR-oriented headless VPS VM subset
  - `nixpi-chat`
  - `nixpi-security`
  - `nixpi-broker`
- `nixos-full`: comprehensive headless VPS VM lane
  - registered tests: `nixpi-firstboot`, `nixpi-bootstrap-fresh-install`, `nixpi-chat`, `nixpi-network`, `nixpi-e2e`, `nixpi-security`, `nixpi-modular-services`, `nixpi-post-setup-lockdown`, `nixpi-broker`, `nixpi-update`, `nixpi-options-validation`
- `nixos-destructive`: slower install/lockdown/broker cases intended for manual or scheduled runs
  - `nixpi-post-setup-lockdown`
  - `nixpi-broker`

## Running Tests

### Run fast local checks
```bash
nix build .#checks.x86_64-linux.vps-topology --no-link
nix build .#checks.x86_64-linux.config --no-link
nix build .#checks.x86_64-linux.config-stable-bootstrap --no-link -L
nix build .#checks.x86_64-linux.nixos-smoke --no-link -L
```

### Run the full VM lane
```bash
nix build .#checks.x86_64-linux.nixos-full --no-link -L
```

### Run the destructive lane
```bash
nix build .#checks.x86_64-linux.nixos-destructive --no-link -L
```

### Run a specific test
```bash
nix build .#checks.x86_64-linux.nixpi-vps-bootstrap --no-link -L
nix build .#checks.x86_64-linux.nixpi-bootstrap-fresh-install-stable --no-link -L
nix build .#checks.x86_64-linux.nixpi-chat --no-link -L
```

### Run the external fresh-install bootstrap harness
```bash
nix run .#nixpi-bootstrap-fresh-install-harness
```

This launches the NixOS test driver outside the Nix build sandbox so the host
side can use its normal Nix daemon/store while the guest VM exercises the full
bootstrap path on a pristine system.

Common direct commands:
```bash
nix --option substituters https://cache.nixos.org/ build .#checks.x86_64-linux.config --no-link
nix --option substituters https://cache.nixos.org/ --max-jobs 1 build .#checks.x86_64-linux.nixos-smoke --no-link -L
nix --option substituters https://cache.nixos.org/ --max-jobs 1 build .#checks.x86_64-linux.nixos-full --no-link -L
nix --option substituters https://cache.nixos.org/ --max-jobs 1 build .#checks.x86_64-linux.nixos-destructive --no-link -L
```

### Interactive test driver
```bash
$(nix-build -A checks.x86_64-linux.nixpi-chat.driverInteractive)/bin/nixos-test-driver
>>> nixpi.start()
>>> nixpi.shell_interact()
```

## Test Structure

```
tests/nixos/
├── lib.nix              # Shared test helpers and module lists
├── default.nix          # Test suite entry point
├── nixpi-broker.nix              # broker autonomy and privilege boundaries
├── nixpi-bootstrap-fresh-install.nix # fresh-install bootstrap contract on a pristine VM
├── nixpi-bootstrap-fresh-install-stable.nix # stable-default bootstrap contract on a pristine VM
├── nixpi-bootstrap-fresh-install-external.nix # external harness for a real offline guest rebuild attempt
├── nixpi-chat.nix                # built-in local chat surface test
├── nixpi-e2e.nix                 # end-to-end integration test
├── nixpi-firstboot.nix           # first-boot remote shell/chat readiness test
├── nixpi-modular-services.nix    # system.services/configData regression
├── nixpi-network.nix             # network/mesh test
├── nixpi-options-validation.nix  # options validation test
├── nixpi-post-setup-lockdown.nix # steady-state post-setup security contract
├── nixpi-security.nix            # security boundary test
├── nixpi-update.nix              # update flow test
├── nixpi-vps-bootstrap.nix       # canonical headless VPS bootstrap smoke test
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
{ pkgs, lib, nixPiModulesNoShell, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  defaults._module.args = {
    inherit nixPiModulesNoShell mkTestFilesystems;
  };

  name = "my-test";
  
  nodes.server = { ... }: {
    imports = nixPiModulesNoShell ++ [ mkTestFilesystems ];
    
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
   nix build .#checks.x86_64-linux.nixpi-chat -L
   ```

2. **Run interactively**: Use the interactive driver to debug
   ```bash
   $(nix-build -A checks.x86_64-linux.nixpi-chat.driverInteractive)/bin/nixos-test-driver
   >>> server.start()
   >>> server.execute("systemctl status nixpi-chat")
   >>> server.shell_interact()  # Get a shell
   ```

3. **Check VM logs**: Tests capture systemd journal output which is printed on failure

## References

- [NixOS Test Driver Documentation](https://nixos.org/manual/nixos/stable/#sec-nixos-tests)
- [NixOS Testing Infrastructure](https://nixos.wiki/wiki/NixOS_Testing_infrastructure)
- [Integration testing with NixOS virtual machines](https://nix.dev/tutorials/integration-testing-using-virtual-machines.html)
