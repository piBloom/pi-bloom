#!/usr/bin/env python3

import argparse
import json
import re
from pathlib import Path

NIXPI_INSTALL_MODULE_TEMPLATE_PATH = "@nixpiInstallModuleTemplate@"


def load_nixpi_install_module_template():
    return Path(NIXPI_INSTALL_MODULE_TEMPLATE_PATH).read_text(encoding="utf-8")


def ensure_import(cfg, import_path):
    import_line = f"    {import_path}"
    if re.search(rf"^\s*{re.escape(import_path)}\s*$", cfg, flags=re.MULTILINE):
        return cfg

    match = re.search(r"imports\s*=\s*\[\s*(?P<body>.*?)\s*\];", cfg, flags=re.DOTALL)
    if match:
        raw_body = match.group("body")
        entries = [line.rstrip() for line in raw_body.splitlines() if line.strip()]
        body = "\n".join(entries)
        replacement_body = f"{body}\n{import_line}" if body else import_line
        return cfg[: match.start("body")] + replacement_body + cfg[match.end("body") :]

    trimmed = cfg.rstrip()
    if trimmed.endswith("}"):
        return trimmed[:-1] + f"\n  imports = [\n{import_line}\n  ];\n}}\n"
    return trimmed + f"\nimports = [\n{import_line}\n];\n"


def upsert_hostname(cfg, hostname):
    line = f'  networking.hostName = "{hostname}";\n'
    if re.search(r"^\s*networking\.hostName\s*=", cfg, flags=re.MULTILINE):
        return re.sub(r'^\s*networking\.hostName\s*=.*$', line.rstrip(), cfg, count=1, flags=re.MULTILINE)

    trimmed = cfg.rstrip()
    if trimmed.endswith("}"):
        return trimmed[:-1] + "\n" + line + "}\n"
    return trimmed + "\n" + line


def load_base_host_config(nixos_etc):
    path = nixos_etc / "configuration.nix"
    if path.exists():
        return path.read_text(encoding="utf-8")
    raise FileNotFoundError(f"missing configuration.nix under {nixos_etc}")


def prepare_nixpi_install_artifacts(root_mount_point, username, hostname, password, cfg):
    nixos_etc = Path(root_mount_point) / "etc/nixos"
    configuration_module = upsert_hostname(ensure_import(cfg, "./nixpi-install.nix"), hostname)
    return {
        "hostname": hostname,
        "nixpi_install_path": str(nixos_etc / "nixpi-install.nix"),
        "configuration_path": str(nixos_etc / "configuration.nix"),
        "configuration_install_ref": str(nixos_etc / "configuration.nix"),
        "nixpi_install_module": (
            load_nixpi_install_module_template()
            .replace("@@username@@", username)
            .replace("@@password@@", json.dumps(password))
        ),
        "configuration_module": configuration_module,
    }


def write_nixpi_install_artifacts(root_mount_point, username, hostname, password, cfg):
    artifacts = prepare_nixpi_install_artifacts(root_mount_point, username, hostname, password, cfg)

    for key, content in (
        ("nixpi_install_path", artifacts["nixpi_install_module"]),
        ("configuration_path", artifacts["configuration_module"]),
    ):
        path = Path(artifacts[key])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    return artifacts


def parse_args():
    parser = argparse.ArgumentParser(
        description="Prepare a mounted NixOS target for a minimal NixPI base install."
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
