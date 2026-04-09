{
  pkgs,
  lib,
  makeWrapper,
  nixosAnywherePackage,
}:

pkgs.stdenvNoCC.mkDerivation {
  pname = "plain-host-deploy";
  version = "0.1.0";

  dontUnpack = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin" "$out/share/plain-host-deploy"
    install -m 0755 ${../../../scripts/plain-host-deploy.sh} "$out/share/plain-host-deploy/plain-host-deploy.sh"
    install -m 0755 ${../../../scripts/plain-host-ovh-common.sh} "$out/share/plain-host-deploy/plain-host-ovh-common.sh"

    makeWrapper ${pkgs.bash}/bin/bash "$out/bin/plain-host-deploy" \
      --set NIXPI_REPO_ROOT ${../../../..} \
      --set NIXPI_NIXOS_ANYWHERE ${nixosAnywherePackage}/bin/nixos-anywhere \
      --prefix PATH : "${lib.makeBinPath [ pkgs.coreutils pkgs.nix ]}" \
      --add-flags "$out/share/plain-host-deploy/plain-host-deploy.sh"

    runHook postInstall
  '';

  meta.mainProgram = "plain-host-deploy";
}
