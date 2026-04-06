{ pkgs, lib, makeWrapper }:

pkgs.stdenvNoCC.mkDerivation {
  pname = "nixpi-bootstrap-vps";
  version = "0.1.0";

  dontUnpack = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin" "$out/share/nixpi-bootstrap"
    install -m 0755 ${./nixpi-bootstrap-vps.sh} "$out/share/nixpi-bootstrap/nixpi-bootstrap-vps.sh"

    makeWrapper ${pkgs.bash}/bin/bash "$out/bin/nixpi-bootstrap-vps" \
      --prefix PATH : "${lib.makeBinPath [ pkgs.coreutils pkgs.git ]}" \
      --add-flags "$out/share/nixpi-bootstrap/nixpi-bootstrap-vps.sh"

    runHook postInstall
  '';

  meta.mainProgram = "nixpi-bootstrap-vps";
}
