import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


def load_module():
    module_path = os.environ.get(
        "NIXPI_INSTALLER_HELPER",
        str(Path(__file__).with_name("nixpi_installer.py")),
    )
    spec = importlib.util.spec_from_file_location("nixpi_installer", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NixpiInstallerTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.template_path = Path(
            os.environ.get(
                "NIXPI_INSTALLER_TEMPLATE",
                str(Path(__file__).with_name("nixpi-install-module.nix.in")),
            )
        )
        self.original_template_path = self.module.NIXPI_INSTALL_MODULE_TEMPLATE_PATH
        self.original_nixpkgs_source = self.module.NIXPKGS_SOURCE
        self.module.NIXPI_INSTALL_MODULE_TEMPLATE_PATH = str(self.template_path)
        self.module.NIXPKGS_SOURCE = "/tmp/fake-nixpkgs"

    def tearDown(self):
        self.module.NIXPI_INSTALL_MODULE_TEMPLATE_PATH = self.original_template_path
        self.module.NIXPKGS_SOURCE = self.original_nixpkgs_source

    def test_prepare_artifacts_generates_managed_user_install(self):
        cfg = "{\n  imports = [\n    ./hardware-configuration.nix\n  ];\n}\n"
        artifacts = self.module.prepare_nixpi_install_artifacts(
            "/mnt/target",
            "alex",
            "pi-box",
            "supersecret",
            cfg,
        )

        self.assertEqual(artifacts["nixpi_install_path"], "/mnt/target/etc/nixos/nixpi-install.nix")
        self.assertEqual(artifacts["nixpi_appliance_path"], "/mnt/target/etc/nixos/nixpi-appliance.nix")
        self.assertEqual(artifacts["nixpi_host_path"], "/mnt/target/etc/nixos/nixpi-host.nix")
        self.assertEqual(artifacts["nixpkgs_source_target"], "/mnt/target/etc/nixos/nixpkgs")
        self.assertEqual(artifacts["flake_path"], "/mnt/target/etc/nixos/flake.nix")
        self.assertEqual(artifacts["configuration_path"], "/mnt/target/etc/nixos/configuration.nix")
        self.assertEqual(artifacts["flake_install_ref"], "/mnt/target/etc/nixos#pi-box")
        self.assertEqual(artifacts["configuration_install_ref"], "/mnt/target/etc/nixos/configuration.nix")
        self.assertIn('nixpi.primaryUser = "alex";', artifacts["nixpi_install_module"])
        self.assertIn('nixpi.install.mode = "managed-user";', artifacts["nixpi_install_module"])
        self.assertIn('nixpi.createPrimaryUser = true;', artifacts["nixpi_install_module"])
        self.assertIn('users.users."alex".initialPassword = "supersecret";', artifacts["nixpi_install_module"])
        self.assertIn('nixosConfigurations."pi-box"', artifacts["nixpi_flake"])
        self.assertIn('./nixpi-appliance.nix', artifacts["nixpi_flake"])
        self.assertIn('./nixpi/core/os/modules/desktop-openbox.nix', artifacts["nixpi_appliance_module"])
        self.assertIn('inputs = {\n    nixpkgs.url = "path:./nixpkgs";', artifacts["nixpi_flake"])
        self.assertNotIn('nixpi.url = "path:./nixpi";', artifacts["nixpi_flake"])
        self.assertIn('networking.hostName = "pi-box";', artifacts["host_cfg"])
        self.assertIn("./nixpi-host.nix", artifacts["configuration_module"])
        self.assertIn("./nixpi-install.nix", artifacts["configuration_module"])

    def test_write_artifacts_copies_source_and_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            nixos_etc = root / "etc/nixos"
            nixos_etc.mkdir(parents=True)
            (nixos_etc / "configuration.nix").write_text(
                "{\n  imports = [\n    ./hardware-configuration.nix\n  ];\n}\n",
                encoding="utf-8",
            )

            source_dir = root / "source"
            source_dir.mkdir()
            (source_dir / "README.md").write_text("nixpi", encoding="utf-8")
            self.module.NIXPI_SOURCE = str(source_dir)
            nixpkgs_dir = root / "nixpkgs-source"
            nixpkgs_dir.mkdir()
            (nixpkgs_dir / "default.nix").write_text("{ }: \"nixpkgs\"", encoding="utf-8")
            self.module.NIXPKGS_SOURCE = str(nixpkgs_dir)

            artifacts = self.module.write_nixpi_install_artifacts(
                root,
                "alex",
                "pi-box",
                "supersecret",
                self.module.load_base_host_config(nixos_etc),
            )

            copied = Path(artifacts["nixpi_source_target"]) / "README.md"
            copied_nixpkgs = Path(artifacts["nixpkgs_source_target"]) / "default.nix"
            self.assertTrue(copied.exists())
            self.assertTrue(copied_nixpkgs.exists())
            self.assertEqual(copied.read_text(encoding="utf-8"), "nixpi")
            self.assertEqual(copied_nixpkgs.read_text(encoding="utf-8"), '{ }: "nixpkgs"')
            for key in ("nixpi_install_path", "nixpi_appliance_path", "nixpi_host_path", "flake_path", "configuration_path"):
                self.assertTrue(Path(artifacts[key]).exists())

    def test_main_prints_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            nixos_etc = root / "etc/nixos"
            nixos_etc.mkdir(parents=True)
            (nixos_etc / "configuration.nix").write_text(
                "{\n  imports = [\n    ./hardware-configuration.nix\n  ];\n}\n",
                encoding="utf-8",
            )

            source_dir = root / "source"
            source_dir.mkdir()
            self.module.NIXPI_SOURCE = str(source_dir)
            nixpkgs_dir = root / "nixpkgs-source"
            nixpkgs_dir.mkdir()
            self.module.NIXPKGS_SOURCE = str(nixpkgs_dir)

            argv = ["nixpi-installer", "--root", tmpdir, "--hostname", "pi-box", "--primary-user", "alex", "--password", "supersecret"]
            with mock.patch("sys.argv", argv):
                with mock.patch("builtins.print") as print_mock:
                    self.module.main()

            payload = json.loads(print_mock.call_args[0][0])
            self.assertEqual(payload["hostname"], "pi-box")


if __name__ == "__main__":
    unittest.main()
