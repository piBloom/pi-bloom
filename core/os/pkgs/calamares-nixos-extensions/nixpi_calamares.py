import os
import shutil
import subprocess
import tempfile
from pathlib import Path

NIXPI_SOURCE = "@nixpiSource@"
TEMPLATE_DIR = Path(__file__).resolve().parent
NIXPI_INSTALL_MODULE_TEMPLATE_PATH = os.environ.get(
    "NIXPI_INSTALL_MODULE_TEMPLATE",
    "@nixpiInstallModuleTemplate@",
)

NIXPI_FLAKE_TEMPLATE = """{
  description = "NixPI installed system";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      piAgent = pkgs.callPackage ./nixpi/core/os/pkgs/pi {};
      appPackage = pkgs.callPackage ./nixpi/core/os/pkgs/app { inherit piAgent; };
    in {
      nixosConfigurations."@@hostname@@" = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = { inherit piAgent appPackage; };
        modules = [
          ./nixpi/core/os/modules/options.nix
          ./nixpi/core/os/modules/app.nix
          ./nixpi/core/os/modules/broker.nix
          ./nixpi/core/os/modules/llm.nix
          ./nixpi/core/os/modules/matrix.nix
          ./nixpi/core/os/modules/network.nix
          ./nixpi/core/os/modules/shell.nix
          ./nixpi/core/os/modules/update.nix
          ./nixpi/core/os/modules/firstboot.nix
          ./nixpi-host.nix
        ];
      };
    };
}
"""


def _string_var(variables, key, default):
    return str(variables.get(key, default))


def strip_nixpi_install_import(cfg):
    return cfg.replace("      ./nixpi-install.nix\n", "", 1)


def load_nixpi_install_module_template():
    template_path = NIXPI_INSTALL_MODULE_TEMPLATE_PATH
    if template_path.startswith("@") and template_path.endswith("@"):
        template_path = str(TEMPLATE_DIR / "nixpi-install-module.nix.in")
    return Path(template_path).read_text(encoding="utf-8")


def prepare_nixpi_install_artifacts(root_mount_point, variables, cfg):
    nixpi_etc = os.path.join(root_mount_point, "etc/nixos")
    username = _string_var(variables, "username", "nixpi")
    hostname = _string_var(variables, "hostname", "nixpi")

    return {
        "hostname": hostname,
        "nixpi_source_target": os.path.join(nixpi_etc, "nixpi"),
        "nixpi_install_path": os.path.join(nixpi_etc, "nixpi-install.nix"),
        "nixpi_host_path": os.path.join(nixpi_etc, "nixpi-host.nix"),
        "flake_path": os.path.join(nixpi_etc, "flake.nix"),
        "flake_install_ref": f"{nixpi_etc}#{hostname}",
        "host_cfg": strip_nixpi_install_import(cfg),
        "nixpi_install_module": load_nixpi_install_module_template().replace("@@username@@", username),
        "nixpi_flake": NIXPI_FLAKE_TEMPLATE.replace("@@hostname@@", hostname),
    }


def write_nixpi_install_artifacts(root_mount_point, variables, cfg, host_env_process_output):
    artifacts = prepare_nixpi_install_artifacts(root_mount_point, variables, cfg)
    source_target = artifacts["nixpi_source_target"]

    subprocess.check_output(["pkexec", "rm", "-rf", source_target], stderr=subprocess.STDOUT)
    subprocess.check_output(["pkexec", "mkdir", "-p", source_target], stderr=subprocess.STDOUT)
    subprocess.check_output(
        ["pkexec", "cp", "-a", os.path.join(NIXPI_SOURCE, "."), source_target],
        stderr=subprocess.STDOUT,
    )

    for path, content in (
        (artifacts["nixpi_install_path"], artifacts["nixpi_install_module"]),
        (artifacts["nixpi_host_path"], artifacts["host_cfg"]),
        (artifacts["flake_path"], artifacts["nixpi_flake"]),
    ):
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as handle:
            handle.write(content)
            temp_path = handle.name
        os.chmod(temp_path, 0o644)
        try:
            subprocess.check_output(
                ["pkexec", "install", "-D", "-m", "0644", temp_path, path],
                stderr=subprocess.STDOUT,
            )
        finally:
            os.unlink(temp_path)

    return artifacts
