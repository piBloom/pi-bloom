{ pkgs, ... }:
{
  # Allow prebuilt generic Linux binaries such as the Open Remote - SSH
  # VSCodium server's bundled node binary to run on NixOS.
  programs.nix-ld = {
    enable = true;
    libraries = with pkgs; [
      stdenv.cc.cc.lib # libstdc++.so.6 for VSCodium/VS Code server node
    ];
  };

  # Global interactive/build tooling for Nazar-managed NixOS machines.
  # Keep this in the OS profile rather than only in flake devShells so admins
  # and VM-local agents have the same baseline tools after login/rebuild.
  environment.systemPackages = with pkgs; [
    cmake
    gcc
    gnumake
    nodejs # includes npm
    pkg-config
    python3
    unzip
  ];
}
