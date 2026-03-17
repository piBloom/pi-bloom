# core/calamares/package.nix
# Custom calamares-nixos-extensions override for Bloom OS.
# Replaces the standard nixos install module with bloom_nixos and adds bloom_prefill.
{ pkgs }:

pkgs.calamares-nixos-extensions.overrideAttrs (old: {
  src = pkgs.runCommand "bloom-calamares-src" {} ''
    # Start from the upstream package source
    cp -r ${old.src} $out
    chmod -R u+w $out

    # Replace the standard nixos module with our bloom_nixos module
    rm -rf $out/modules/nixos
    cp -r ${./bloom_nixos} $out/modules/bloom-nixos

    # Add the bloom_prefill module
    cp -r ${./bloom_prefill} $out/modules/bloom-prefill

    # Add our QML wizard pages
    mkdir -p $out/pages
    cp ${./pages}/*.qml $out/pages/

    # Override Calamares config with our sequence and module configs
    cp ${./config/bloom-settings.conf} $out/settings.conf
    cp ${./config/bloom-nixos.conf}    $out/modules/bloom-nixos/bloom-nixos.conf
    cp ${./config/users.conf}          $out/modules/users/users.conf
  '';
})
