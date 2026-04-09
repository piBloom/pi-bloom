# NixOS Integration Tests for NixPI

This directory contains NixOS integration tests for the retained headless VPS NixPI platform. The tests use `pkgs.testers.runNixOSTest` to boot VMs and verify the declarative install path plus the day-2 service surface.

Bootstrap versus steady-state behavior is selected declaratively via `nixpi.bootstrap.*`; no NixOS VM test should rely on `~/.nixpi/wizard-state/system-ready` or `nixpi-setup-apply`.

## Test Lanes

- `config`: fast non-VM closure build for the retained headless VPS system
- `vps-topology`: fast flake-shape check for the canonical `vps` host profile
- `nixos-smoke`: PR-oriented headless VPS VM subset
  - `nixpi-runtime`
  - `nixpi-security`
  - `nixpi-netbird`
  - `nixpi-broker`
- `nixos-full`: comprehensive retained VM lane
  - `boot`
  - `nixpi-firstboot`
  - `nixpi-system-flake`
  - `nixpi-network`
  - `nixpi-e2e`
  - `nixpi-security`
  - `nixpi-netbird`
  - `nixpi-modular-services`
  - `nixpi-post-setup-lockdown`
  - `nixpi-broker`
  - `nixpi-update`
  - `nixpi-options-validation`
- `nixos-destructive`: slower retained cases intended for manual or scheduled runs
  - `nixpi-post-setup-lockdown`
  - `nixpi-broker`

## Running Tests

### Run fast local checks
```bash
nix build .#checks.x86_64-linux.vps-topology --no-link -L
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
```

### Run a specific test
```bash
nix build .#checks.x86_64-linux.nixpi-firstboot --no-link -L
nix build .#checks.x86_64-linux.nixpi-system-flake --no-link -L
nix build .#checks.x86_64-linux.nixpi-runtime --no-link -L
```

Common direct commands:
```bash
nix --option substituters https://cache.nixos.org/ build .#checks.x86_64-linux.config --no-link
nix --option substituters https://cache.nixos.org/ --max-jobs 1 build .#checks.x86_64-linux.nixos-smoke --no-link -L
nix --option substituters https://cache.nixos.org/ --max-jobs 1 build .#checks.x86_64-linux.nixos-full --no-link -L
nix --option substituters https://cache.nixos.org/ --max-jobs 1 build .#checks.x86_64-linux.nixos-destructive --no-link -L
```

### Interactive test driver
```bash
$(nix-build -A checks.x86_64-linux.nixpi-runtime.driverInteractive)/bin/nixos-test-driver
>>> nixpi.start()
>>> nixpi.shell_interact()
```

## Test Structure

```
tests/nixos/
├── lib.nix                     # shared test helpers and module lists
├── default.nix                 # test suite entry point
├── nixpi-broker.nix            # broker autonomy and privilege boundaries
├── nixpi-e2e.nix               # end-to-end integration test
├── nixpi-firstboot.nix         # declarative first-boot contract
├── nixpi-modular-services.nix  # system.services/configData regression
├── nixpi-network.nix           # network/mesh test
├── nixpi-options-validation.nix# options validation test
├── nixpi-post-setup-lockdown.nix # steady-state post-setup security contract
├── nixpi-runtime.nix           # shell-first Pi runtime smoke test
├── nixpi-security.nix          # security boundary test
├── nixpi-system-flake.nix      # retained name; now asserts no runtime /etc/nixos flake generation
├── nixpi-update.nix            # update flow test
├── nixpi-netbird.nix           # NetBird client configuration test
└── README.md                   # this file
```

## Writing New Tests

When writing new NixOS tests:

1. **Don't set `nixpkgs.config` in test nodes** - The test framework injects its own `pkgs` and will reject `nixpkgs.config` settings. Use `pkgsUnfree` in `flake.nix` if you need unfree packages.
2. **Escape `''` in test scripts** - Nix indented strings use `''`. Escape literal `''` in Python snippets as `''''`.
3. **Escape `${` in test scripts** - Nix interprets `${` as antiquotation. Escape it as `''${` inside indented strings.
4. **Use `nixPiModulesNoShell` when defining your own user** - The shell module defines the primary operator account from `nixpi.primaryUser`, so tests that define their own user should use `nixPiModulesNoShell`.

## CI Integration

- `.github/workflows/check.yml` runs TypeScript checks plus `checks.x86_64-linux.config`, `checks.x86_64-linux.flake-topology`, and `checks.x86_64-linux.vps-topology`
- `.github/workflows/nixos-vm.yml` runs `nixos-smoke`, `nixos-full`, or `nixos-destructive` on a self-hosted runner

## References

- [NixOS Test Driver Documentation](https://nixos.org/manual/nixos/stable/#sec-nixos-tests)
- [NixOS Testing Infrastructure](https://nixos.wiki/wiki/NixOS_Testing_infrastructure)
- [Integration testing with NixOS virtual machines](https://nix.dev/tutorials/integration-testing-using-virtual-machines.html)
