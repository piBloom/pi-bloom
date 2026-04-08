# core/os/pkgs/app/default.nix
{ lib, buildNpmPackage, piAgent }:

buildNpmPackage {
  pname = "app";
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
          || lib.hasPrefix "/core/os" rel
          || lib.hasPrefix "/.git" rel
          || lib.hasSuffix ".qcow2" rel
          || lib.hasSuffix ".iso" rel);
  };

  npmDepsHash = "sha256-FKRPimOKEiSPczn4pCa7V0Gn6S4/3YH41EKReF8E4P0=";
  buildPhase = ''
    runHook preBuild
    npm run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/nixpi/core/pi
    cp -r dist package.json node_modules $out/share/nixpi/
    cp -r core/pi/persona $out/share/nixpi/core/pi/persona
    cp -r core/pi/skills  $out/share/nixpi/core/pi/skills

    mkdir -p $out/bin

    # Replace @mariozechner/pi-coding-agent with symlinks into piAgent store path.
    # Do NOT remove other @mariozechner packages (e.g. jiti) — only replace pi-coding-agent.
    rm -rf $out/share/nixpi/node_modules/@mariozechner/pi-coding-agent
    ln -sf ${piAgent}/lib/node_modules/@mariozechner/pi-coding-agent \
      $out/share/nixpi/node_modules/@mariozechner/pi-coding-agent

    # pi-ai lives nested under pi-coding-agent in the piAgent output.
    # If it also exists at top-level @mariozechner, replace it; otherwise skip.
    if [ -d "$out/share/nixpi/node_modules/@mariozechner/pi-ai" ]; then
      rm -rf $out/share/nixpi/node_modules/@mariozechner/pi-ai
    fi
    ln -sf ${piAgent}/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai \
      $out/share/nixpi/node_modules/@mariozechner/pi-ai || true

    mkdir -p $out/share/nixpi/.pi
    echo '{"packages": ["/usr/local/share/nixpi"]}' > $out/share/nixpi/.pi/settings.json

    # extensions symlink — package.json references ./core/pi/extensions but compiled JS lands in dist/
    ln -sf $out/share/nixpi/dist/core/pi/extensions $out/share/nixpi/core/pi/extensions

    # persona and skills symlinks — use absolute paths so they resolve correctly at runtime
    ln -sf $out/share/nixpi/core/pi/persona $out/share/nixpi/persona
    ln -sf $out/share/nixpi/core/pi/skills  $out/share/nixpi/skills

    runHook postInstall
  '';

  meta = {
    description = "NixPI TypeScript application";
    license = lib.licenses.mit;
  };
}
