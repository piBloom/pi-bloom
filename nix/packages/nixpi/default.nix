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
  npmDepsHash = "sha256-+S8aqovxG6b44Cw9b5+NXHUZ/1QB4LMMHpo0FvMvnlA=";

  nativeBuildInputs = [ makeWrapper ];

  dontNpmBuild = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/nixpi $out/bin
    cp -R \
      package.json \
      package-lock.json \
      server.js \
      sessions.js \
      workspaces.js \
      bin \
      public \
      node_modules \
      $out/lib/nixpi/

    makeWrapper ${nodejs_22}/bin/node $out/bin/nixpi \
      --add-flags $out/lib/nixpi/bin/nixpi.js

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
