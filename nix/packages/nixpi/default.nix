{
  lib,
  buildNpmPackage,
  makeWrapper,
  nodejs_22,
}:

let
  package = lib.importJSON ../../../package.json;
  buildNpmPackage' = buildNpmPackage.override { nodejs = nodejs_22; };
in
buildNpmPackage' {
  pname = "nixpi";
  inherit (package) version;

  src = lib.cleanSource ../../..;

  npmDepsFetcherVersion = 2;
  npmDepsHash = "sha256-AKUWEkJgdaGfAQZJtjTc3E3lbcahvM5uXnpQ25BhqdQ=";

  nativeBuildInputs = [ makeWrapper ];

  dontNpmBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/nixpi $out/bin
    cp -R \
      package.json \
      package-lock.json \
      server.js \
      public \
      node_modules \
      $out/lib/nixpi/

    makeWrapper ${nodejs_22}/bin/node $out/bin/nixpi \
      --add-flags $out/lib/nixpi/server.js

    runHook postInstall
  '';

  passthru.category = "AI Coding Agents";

  meta = {
    description = "Private web interface for Pi Coding Agent";
    homepage = "https://git.nazar.studio/nazar/nixpi";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
    mainProgram = "nixpi";
  };
}
