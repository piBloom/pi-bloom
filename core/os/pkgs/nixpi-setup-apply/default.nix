{ stdenvNoCC, makeWrapper, jq, git, netbird, nixos-rebuild ? null }:

stdenvNoCC.mkDerivation {
  pname = "nixpi-setup-apply";
  version = "0.1.0";

  dontUnpack = true;

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin"
    install -m 0755 ${../../../scripts/nixpi-setup-apply.sh} "$out/bin/nixpi-setup-apply"
    wrapProgram "$out/bin/nixpi-setup-apply" \
      --prefix PATH : ${jq}/bin \
      --prefix PATH : ${git}/bin \
      --prefix PATH : ${netbird}/bin
    runHook postInstall
  '';
}
