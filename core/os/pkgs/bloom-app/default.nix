# core/os/pkgs/bloom-app/default.nix
{ lib, buildNpmPackage, nodejs, piAgent }:

buildNpmPackage {
  pname = "bloom-app";
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
          || lib.hasPrefix "/core/os" rel
          || lib.hasPrefix "/.git" rel
          || lib.hasSuffix ".qcow2" rel
          || lib.hasSuffix ".iso" rel);
  };

  npmDepsHash = "sha256-jCOewq9romqvp7OwjF8KXcv9rmdxTJcgzvfhsj2HVO8=";

  buildPhase = ''
    runHook preBuild
    npm run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/bloom/core
    cp -r dist package.json node_modules $out/share/bloom/
    cp -r core/pi-persona $out/share/bloom/core/pi-persona
    cp -r core/pi-skills  $out/share/bloom/core/pi-skills

    mkdir -p $out/bin
    install -m 755 ${../../../scripts/bloom-lib.sh} $out/bin/bloom-lib.sh
    install -m 755 ${../../../scripts/bloom-wizard.sh} $out/bin/bloom-wizard.sh
    install -m 755 ${../../../scripts/bloom-greeting.sh} $out/bin/bloom-greeting.sh

    # Replace @mariozechner/pi-coding-agent with symlinks into piAgent store path.
    # Do NOT remove other @mariozechner packages (e.g. jiti) — only replace pi-coding-agent.
    rm -rf $out/share/bloom/node_modules/@mariozechner/pi-coding-agent
    ln -sf ${piAgent}/lib/node_modules/@mariozechner/pi-coding-agent \
      $out/share/bloom/node_modules/@mariozechner/pi-coding-agent

    # pi-ai lives nested under pi-coding-agent in the piAgent output.
    # If it also exists at top-level @mariozechner, replace it; otherwise skip.
    if [ -d "$out/share/bloom/node_modules/@mariozechner/pi-ai" ]; then
      rm -rf $out/share/bloom/node_modules/@mariozechner/pi-ai
    fi
    ln -sf ${piAgent}/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai \
      $out/share/bloom/node_modules/@mariozechner/pi-ai || true

    mkdir -p $out/share/bloom/.pi/agent
    echo '{"packages": ["/usr/local/share/bloom"]}' > $out/share/bloom/.pi/agent/settings.json

    # extensions symlink — package.json references ./core/pi-extensions but compiled JS lands in dist/
    ln -sf $out/share/bloom/dist/core/pi-extensions $out/share/bloom/core/pi-extensions

    # persona and skills symlinks — use absolute paths so they resolve correctly at runtime
    ln -sf $out/share/bloom/core/pi-persona $out/share/bloom/persona
    ln -sf $out/share/bloom/core/pi-skills  $out/share/bloom/skills

    runHook postInstall
  '';

  meta = {
    description = "Bloom AI companion OS TypeScript application";
    license = lib.licenses.mit;
  };
}
