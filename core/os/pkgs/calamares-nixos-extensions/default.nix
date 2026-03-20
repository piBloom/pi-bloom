{
  stdenv,
  lib,
  glibcLocales,
  python3,
  pkgs,
  nixpiSource,
}:

stdenv.mkDerivation {
  pname = "calamares-nixos-extensions";
  version = "0.3.23-nixpi";

  src = "${pkgs.path}/pkgs/by-name/ca/calamares-nixos-extensions/src";
  nativeBuildInputs = [ python3 ];

  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    cp -r "$src" source
    chmod -R u+w source

    python <<'PY'
from pathlib import Path

path = Path("source/modules/nixos/main.py")
text = path.read_text()

old_header = """{
  imports =
    [ # Include the results of the hardware scan.
      ./hardware-configuration.nix
    ];

"""
new_header = """{
  imports =
    [ # Include the results of the hardware scan.
      ./hardware-configuration.nix
      ./nixpi-install.nix
    ];

"""
text = text.replace(old_header, new_header, 1)
text = text.replace("import re\n", "import re\nimport shutil\n", 1)

marker = 'def env_is_set(name):\n'
injected = """NIXPI_SOURCE = "@nixpiSource@"

NIXPI_INSTALL_MODULE = \"\"\"{ ... }:

{
  imports = [
    ./nixpi/core/os/modules/app.nix
    ./nixpi/core/os/modules/broker.nix
    ./nixpi/core/os/modules/firstboot.nix
    ./nixpi/core/os/modules/llm.nix
    ./nixpi/core/os/modules/matrix.nix
    ./nixpi/core/os/modules/network.nix
    ./nixpi/core/os/modules/shell.nix
    ./nixpi/core/os/modules/update.nix
  ];

  nixpi.primaryUser = "@@username@@";
  nixpi.install.mode = "existing-user";
  nixpi.createPrimaryUser = false;

  nixpkgs.config.allowUnfree = true;
}
\"\"\"

NIXPI_FLAKE = \"\"\"{
  description = "NixPI installed system";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpi.url = "github:alexradunet/NixPI";
  };

  outputs = { nixpkgs, nixpi, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.''${system};
      piAgent = pkgs.callPackage "''${nixpi}/core/os/pkgs/pi" {};
      appPackage = pkgs.callPackage "''${nixpi}/core/os/pkgs/app" { inherit piAgent; };
    in {
      nixosConfigurations."@@hostname@@" = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = { inherit piAgent appPackage; };
        modules = [
          nixpi.nixosModules.nixpi
          nixpi.nixosModules.firstboot
          ./nixpi-host.nix
        ];
      };
    };
}
\"\"\"

"""
text = text.replace(marker, injected + marker, 1)

old_write = """    # Write the configuration.nix file
    libcalamares.utils.host_env_process_output(["cp", "/dev/stdin", config], None, cfg)
"""
new_write = """    # Materialize the NixPI installation helpers and the standard /etc/nixos flake.
    nixpi_etc = os.path.join(root_mount_point, "etc/nixos")
    nixpi_source_target = os.path.join(nixpi_etc, "nixpi")
    nixpi_install_path = os.path.join(nixpi_etc, "nixpi-install.nix")
    nixpi_host_path = os.path.join(nixpi_etc, "nixpi-host.nix")
    flake_path = os.path.join(nixpi_etc, "flake.nix")

    host_cfg = cfg.replace("      ./nixpi-install.nix\\n", "", 1)
    username = str(variables.get("username", "nixpi"))
    hostname = str(variables.get("hostname", "nixpi"))

    nixpi_install_module = NIXPI_INSTALL_MODULE.replace("@@username@@", username)
    nixpi_flake = NIXPI_FLAKE.replace("@@hostname@@", hostname)

    if os.path.exists(nixpi_source_target):
        shutil.rmtree(nixpi_source_target)
    shutil.copytree(NIXPI_SOURCE, nixpi_source_target, symlinks=True)

    libcalamares.utils.host_env_process_output(["cp", "/dev/stdin", nixpi_install_path], None, nixpi_install_module)
    libcalamares.utils.host_env_process_output(["cp", "/dev/stdin", nixpi_host_path], None, host_cfg)
    libcalamares.utils.host_env_process_output(["cp", "/dev/stdin", flake_path], None, nixpi_flake)

    # Write the configuration.nix file used by nixos-install itself.
    libcalamares.utils.host_env_process_output(["cp", "/dev/stdin", config], None, cfg)
"""
text = text.replace(old_write, new_write, 1)

path.write_text(text)
PY

    mkdir -p "$out"/{etc,lib,share}/calamares
    cp -r source/modules "$out/lib/calamares/"
    cp -r source/config/* "$out/etc/calamares/"
    cp -r source/branding "$out/share/calamares/"

    substituteInPlace "$out/etc/calamares/settings.conf" --replace-fail @out@ "$out"
    substituteInPlace "$out/etc/calamares/modules/locale.conf" --replace-fail @glibcLocales@ "${glibcLocales}"
    substituteInPlace "$out/lib/calamares/modules/nixos/main.py" --replace-fail "@nixpiSource@" "${nixpiSource}"
    PYTHONPYCACHEPREFIX="$(mktemp -d)" python3 -m py_compile "$out/lib/calamares/modules/nixos/main.py"

    runHook postInstall
  '';

  meta = {
    description = "Calamares modules for NixPI installs on NixOS";
    homepage = "https://github.com/alexradunet/NixPI";
    license = with lib.licenses; [ mit cc-by-40 cc-by-sa-40 ];
    platforms = lib.platforms.linux;
  };
}
