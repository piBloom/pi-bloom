#!/usr/bin/env python3

import argparse
import json
import re
import shutil
from pathlib import Path

NIXPI_SOURCE = "@nixpiSource@"
NIXPKGS_SOURCE = "@nixpkgsSource@"
NIXPI_INSTALL_MODULE_TEMPLATE_PATH = "@nixpiInstallModuleTemplate@"

NIXPI_FLAKE_TEMPLATE = """{
  description = "NixPI installed system";

  inputs = {
    nixpkgs.url = "path:./nixpkgs";
  };

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      setupPackage = pkgs.callPackage ./nixpi/core/os/pkgs/setup {};
      piAgent = pkgs.callPackage ./nixpi/core/os/pkgs/pi {};
      appPackage = pkgs.callPackage ./nixpi/core/os/pkgs/app { inherit piAgent; };
    in {
      nixosConfigurations."@@hostname@@" = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = { inherit setupPackage piAgent appPackage; };
        modules = [
          ./nixpi-host.nix
          ./nixpi-appliance.nix
        ];
      };
    };
}
"""

NIXPI_APPLIANCE_TEMPLATE = """{ pkgs, setupPackage, ... }:

let
  piAgent = pkgs.callPackage ./nixpi/core/os/pkgs/pi {};
  appPackage = pkgs.callPackage ./nixpi/core/os/pkgs/app { inherit piAgent; };
in
{
  _module.args = { inherit setupPackage piAgent appPackage; };

  imports = [
    ./nixpi/core/os/modules/options.nix
    ./nixpi/core/os/modules/setup.nix
    ./nixpi/core/os/modules/runtime.nix
    ./nixpi/core/os/modules/collab.nix
    ./nixpi/core/os/modules/llm.nix
    ./nixpi/core/os/modules/network.nix
    ./nixpi/core/os/modules/shell.nix
    ./nixpi/core/os/modules/tooling.nix
    ./nixpi/core/os/modules/update.nix
    ./nixpi/core/os/modules/firstboot.nix
    ./nixpi/core/os/modules/desktop-openbox.nix
  ];

  nixpkgs.config.allowUnfree = true;
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
}
"""

NIXPI_CONFIGURATION_TEMPLATE = """{ ... }:
{
  imports = [
    ./nixpi-host.nix
    ./nixpi-install.nix
  ];
}
"""


def load_nixpi_install_module_template():
    return Path(NIXPI_INSTALL_MODULE_TEMPLATE_PATH).read_text(encoding="utf-8")


def strip_nixpi_imports(cfg):
    return re.sub(r'^\s*\./nixpi-(install|host)\.nix\s*\n', "", cfg, flags=re.MULTILINE)


def upsert_hostname(cfg, hostname):
    line = f'  networking.hostName = "{hostname}";\n'
    if re.search(r"^\s*networking\.hostName\s*=", cfg, flags=re.MULTILINE):
        return re.sub(r'^\s*networking\.hostName\s*=.*$', line.rstrip(), cfg, count=1, flags=re.MULTILINE)

    trimmed = cfg.rstrip()
    if trimmed.endswith("}"):
        return trimmed[:-1] + "\n" + line + "}\n"
    return trimmed + "\n" + line


def load_base_host_config(nixos_etc):
    for name in ("nixpi-host.nix", "configuration.nix"):
        path = nixos_etc / name
        if path.exists():
            return path.read_text(encoding="utf-8")
    raise FileNotFoundError(f"missing configuration.nix under {nixos_etc}")


def prepare_nixpi_install_artifacts(root_mount_point, username, hostname, password, cfg):
    nixos_etc = Path(root_mount_point) / "etc/nixos"
    host_cfg = upsert_hostname(strip_nixpi_imports(cfg), hostname)
    return {
        "hostname": hostname,
        "nixpi_source_target": str(nixos_etc / "nixpi"),
        "nixpkgs_source_target": str(nixos_etc / "nixpkgs"),
        "nixpi_install_path": str(nixos_etc / "nixpi-install.nix"),
        "nixpi_appliance_path": str(nixos_etc / "nixpi-appliance.nix"),
        "nixpi_host_path": str(nixos_etc / "nixpi-host.nix"),
        "flake_path": str(nixos_etc / "flake.nix"),
        "configuration_path": str(nixos_etc / "configuration.nix"),
        "flake_install_ref": f"{nixos_etc}#{hostname}",
        "configuration_install_ref": str(nixos_etc / "configuration.nix"),
        "nixpi_install_module": (
            load_nixpi_install_module_template()
            .replace("@@username@@", username)
            .replace("@@password@@", json.dumps(password))
        ),
        "nixpi_appliance_module": NIXPI_APPLIANCE_TEMPLATE,
        "nixpi_flake": NIXPI_FLAKE_TEMPLATE.replace("@@hostname@@", hostname),
        "configuration_module": NIXPI_CONFIGURATION_TEMPLATE,
        "host_cfg": host_cfg,
    }


def write_nixpi_install_artifacts(root_mount_point, username, hostname, password, cfg):
    artifacts = prepare_nixpi_install_artifacts(root_mount_point, username, hostname, password, cfg)
    nixpi_source_target = Path(artifacts["nixpi_source_target"])
    nixpi_source_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(nixpi_source_target, ignore_errors=True)
    shutil.copytree(NIXPI_SOURCE, nixpi_source_target, symlinks=True)
    nixpkgs_source_target = Path(artifacts["nixpkgs_source_target"])
    shutil.rmtree(nixpkgs_source_target, ignore_errors=True)
    shutil.copytree(NIXPKGS_SOURCE, nixpkgs_source_target, symlinks=True)

    for key, content in (
        ("nixpi_install_path", artifacts["nixpi_install_module"]),
        ("nixpi_appliance_path", artifacts["nixpi_appliance_module"]),
        ("nixpi_host_path", artifacts["host_cfg"]),
        ("flake_path", artifacts["nixpi_flake"]),
        ("configuration_path", artifacts["configuration_module"]),
    ):
        path = Path(artifacts[key])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    return artifacts


def parse_args():
    parser = argparse.ArgumentParser(
        description="Prepare a mounted NixOS target for a local NixPI flake install."
    )
    parser.add_argument("--root", default="/mnt", help="mounted target root")
    parser.add_argument("--hostname", required=True, help="hostname for the installed machine")
    parser.add_argument("--primary-user", required=True, help="primary managed operator account")
    parser.add_argument("--password", required=True, help="initial password for the managed operator account")
    return parser.parse_args()


def main():
    args = parse_args()
    root = Path(args.root)
    nixos_etc = root / "etc/nixos"
    if not nixos_etc.exists():
        raise SystemExit(f"{nixos_etc} does not exist; run nixos-generate-config --root {root} first")

    cfg = load_base_host_config(nixos_etc)
    artifacts = write_nixpi_install_artifacts(root, args.primary_user, args.hostname, args.password, cfg)
    print(json.dumps(artifacts, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
