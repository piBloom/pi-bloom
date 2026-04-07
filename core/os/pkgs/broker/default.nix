{ lib, buildNpmPackage, nodejs, makeWrapper }:

buildNpmPackage {
  pname = "nixpi-broker";
  version = "0.1.0";

  src = lib.cleanSourceWith {
    src = ../../../..;
    filter = path: _type:
      let
        rel = lib.removePrefix (toString ../../../..) (toString path);
      in
        !(lib.hasPrefix "/node_modules" rel
          || lib.hasPrefix "/dist" rel
          || lib.hasPrefix "/coverage" rel
          || lib.hasPrefix "/tests" rel
          || lib.hasPrefix "/.git" rel
          || lib.hasSuffix ".qcow2" rel
          || lib.hasSuffix ".iso" rel);
  };

  npmDepsHash = "sha256-e/3UDUxgnusL8XUoIL3kSR8W/udpBXFsW695cWHw3NA=";
  npmDepsFetcherVersion = 2;

  nativeBuildInputs = [ makeWrapper ];

  buildPhase = ''
    runHook preBuild
    ./node_modules/.bin/tsc \
      --module NodeNext \
      --moduleResolution NodeNext \
      --target ES2022 \
      --rootDir . \
      --outDir build-dist \
      core/os/broker.ts
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/libexec/nixpi-broker $out/bin
    cp build-dist/core/os/broker.js $out/libexec/nixpi-broker/broker.mjs
    makeWrapper ${nodejs}/bin/node $out/bin/nixpi-broker \
      --add-flags "$out/libexec/nixpi-broker/broker.mjs"
    runHook postInstall
  '';

  meta.mainProgram = "nixpi-broker";
}
