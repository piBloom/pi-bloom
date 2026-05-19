{
  lib,
  stdenvNoCC,
  bun,
  makeWrapper,
}:

stdenvNoCC.mkDerivation {
  pname = "life-os";
  version = "0.1.0";

  src = ./.;

  nativeBuildInputs = [ makeWrapper ];

  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/life-os $out/bin
    cp -R package.json src $out/share/life-os/

    makeWrapper ${lib.getExe bun} $out/bin/life \
      --add-flags "$out/share/life-os/src/life.ts"

    runHook postInstall
  '';

  meta = {
    description = "Small standards-first Life OS CLI";
    mainProgram = "life";
    platforms = lib.platforms.linux;
  };
}
