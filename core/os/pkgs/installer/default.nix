{ pkgs, makeWrapper, nixpiSource, piAgent, appPackage }:

let
  layoutsDir = ../../installer/layouts;
in

pkgs.stdenvNoCC.mkDerivation {
  pname = "nixpi-installer";
  version = "0.2.0";

  dontUnpack = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin" "$out/share/nixpi-installer/layouts"

    install -m 0644 ${./nixpi-install-module.nix.in} "$out/share/nixpi-installer/nixpi-install-module.nix.in"
    install -m 0755 ${./nixpi-installer.sh} "$out/share/nixpi-installer/nixpi-installer.sh"
    install -m 0644 ${layoutsDir}/standard.nix "$out/share/nixpi-installer/layouts/standard.nix"
    install -m 0644 ${layoutsDir}/swap.nix "$out/share/nixpi-installer/layouts/swap.nix"

    substituteInPlace "$out/share/nixpi-installer/nixpi-install-module.nix.in" \
      --replace-fail "@piAgent@" "${piAgent}" \
      --replace-fail "@appPackage@" "${appPackage}" \
      --replace-fail "@firstbootModule@" "${nixpiSource}/core/os/modules/firstboot/default.nix" \
      --replace-fail "@desktopXfceModule@" "${nixpiSource}/core/os/modules/desktop-xfce.nix" \
      --replace-fail "@networkModule@" "${nixpiSource}/core/os/modules/network.nix" \
      --replace-fail "@shellModule@" "${nixpiSource}/core/os/modules/shell.nix" \
      --replace-fail "@updateModule@" "${nixpiSource}/core/os/modules/update.nix"

    substituteInPlace "$out/share/nixpi-installer/nixpi-installer.sh" \
      --replace-fail "@installModuleTemplate@" "$out/share/nixpi-installer/nixpi-install-module.nix.in" \
      --replace-fail "@layoutStandard@" "$out/share/nixpi-installer/layouts/standard.nix" \
      --replace-fail "@layoutSwap@" "$out/share/nixpi-installer/layouts/swap.nix"

    makeWrapper ${pkgs.bash}/bin/bash "$out/bin/nixpi-installer" \
      --prefix PATH : "${pkgs.lib.makeBinPath [ pkgs.openssl ]}" \
      --add-flags "$out/share/nixpi-installer/nixpi-installer.sh"

    runHook postInstall
  '';
}
