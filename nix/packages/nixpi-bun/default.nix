{
  lib,
  bun,
  makeWrapper,
  stdenvNoCC,
}:

let
  package = lib.importJSON ../../../package.json;
in
stdenvNoCC.mkDerivation {
  pname = "nixpi-bun";
  inherit (package) version;

  src = lib.cleanSource ../../..;

  nativeBuildInputs = [ makeWrapper ];

  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/nixpi-bun $out/bin
    cp -R \
      package.json \
      server.js \
      sessions.js \
      workspaces.js \
      bin \
      public \
      $out/lib/nixpi-bun/

    makeWrapper ${bun}/bin/bun $out/bin/nixpi-bun \
      --add-flags $out/lib/nixpi-bun/bin/nixpi-bun.js

    runHook postInstall
  '';

  passthru.category = "AI Coding Agents";

  meta = {
    description = "Experimental Bun-native private web interface for Pi Coding Agent";
    homepage = "https://git.nazar.studio/nazar/nixpi-bun";
    license = lib.licenses.mit;
    platforms = bun.meta.platforms;
    mainProgram = "nixpi-bun";
  };
}
