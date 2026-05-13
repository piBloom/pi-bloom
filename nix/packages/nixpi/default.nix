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
  npmDepsHash = "sha256-Kfmq6Gji3wnqDKvqG7nq7bW6JfuQEPAZqzXKCNGqZZ4=";

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
      bin \
      node_modules \
      $out/lib/nixpi/

    chmod +x $out/lib/nixpi/bin/nixpi.js
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
