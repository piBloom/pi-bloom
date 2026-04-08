{ stdenvNoCC }:

stdenvNoCC.mkDerivation {
  pname = "nixpi-terminal-bootstrap";
  version = "0.1.0";
  dontUnpack = true;

  installPhase = ''
    mkdir -p "$out/bin"
    install -m 0755 ${../../../scripts/nixpi-terminal-bootstrap.sh} "$out/bin/nixpi-terminal-bootstrap"
  '';
}
