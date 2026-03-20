{ nixpiSource }:

final: prev: {
  calamares-nixos-extensions = final.callPackage ../pkgs/calamares-nixos-extensions/default.nix {
    inherit nixpiSource;
  };

  calamares-nixos = prev.calamares-nixos.override {
    calamares-nixos-extensions = final.calamares-nixos-extensions;
  };
}
