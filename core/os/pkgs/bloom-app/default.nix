# core/os/pkgs/bloom-app/default.nix — evaluation stub; replaced in Task 4
{ lib, buildNpmPackage, nodejs, piAgent }: buildNpmPackage {
  pname = "bloom-app";
  version = "0.1.0";
  src = lib.cleanSourceWith { src = ../../../..; filter = _: _: true; };
  npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
}
