{ stdenvNoCC, makeWrapper }:

stdenvNoCC.mkDerivation {
  pname = "nixpi-setup-apply";
  version = "0.2.0";

  dontUnpack = true;

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin"
    install -m 0755 ${../../../scripts/nixpi-setup-apply.sh} "$out/bin/nixpi-setup-apply"
    wrapProgram "$out/bin/nixpi-setup-apply"
    runHook postInstall
  '';
}
