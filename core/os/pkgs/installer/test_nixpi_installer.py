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
        self.module.NIXPI_INSTALL_MODULE_TEMPLATE_PATH = str(self.template_path)

    def tearDown(self):
        self.module.NIXPI_INSTALL_MODULE_TEMPLATE_PATH = self.original_template_path

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
        self.assertEqual(artifacts["configuration_path"], "/mnt/target/etc/nixos/configuration.nix")
        self.assertEqual(artifacts["configuration_install_ref"], "/mnt/target/etc/nixos/configuration.nix")
        self.assertIn('nixpi.primaryUser = "alex";', artifacts["nixpi_install_module"])
        self.assertIn('nixpi.install.mode = "managed-user";', artifacts["nixpi_install_module"])
        self.assertIn('nixpi.createPrimaryUser = true;', artifacts["nixpi_install_module"])
        self.assertIn('users.users."alex".initialPassword = "supersecret";', artifacts["nixpi_install_module"])
        self.assertIn('bootstrapPasswordFile = "${config.nixpi.stateDir}/bootstrap/primary-user-password";', artifacts["nixpi_install_module"])
        self.assertIn("system.activationScripts.nixpi-bootstrap-primary-password", artifacts["nixpi_install_module"])
        self.assertIn("printf '%s' \"supersecret\" > ${bootstrapPasswordFile}", artifacts["nixpi_install_module"])
        self.assertIn('networking.hostName = "pi-box";', artifacts["configuration_module"])
        self.assertIn("./hardware-configuration.nix", artifacts["configuration_module"])
        self.assertIn("./nixpi-install.nix", artifacts["configuration_module"])

    def test_write_artifacts_writes_minimal_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            nixos_etc = root / "etc/nixos"
            nixos_etc.mkdir(parents=True)
            (nixos_etc / "configuration.nix").write_text(
                "{\n  imports = [\n    ./hardware-configuration.nix\n  ];\n}\n",
                encoding="utf-8",
            )

            artifacts = self.module.write_nixpi_install_artifacts(
                root,
                "alex",
                "pi-box",
                "supersecret",
                self.module.load_base_host_config(nixos_etc),
            )

            for key in ("nixpi_install_path", "configuration_path"):
                self.assertTrue(Path(artifacts[key]).exists())
            self.assertFalse((nixos_etc / "nixpi").exists())
            self.assertFalse((nixos_etc / "nixpkgs").exists())
            self.assertFalse((nixos_etc / "flake.nix").exists())

    def test_prepare_artifacts_updates_single_line_imports_block(self):
        cfg = "{\n  imports = [ ./hardware-configuration.nix ];\n}\n"

        artifacts = self.module.prepare_nixpi_install_artifacts(
            "/mnt/target",
            "alex",
            "pi-box",
            "supersecret",
            cfg,
        )

        self.assertEqual(artifacts["configuration_module"].count("imports = ["), 1)
        self.assertIn("  imports = [\n", artifacts["configuration_module"])
        self.assertIn("    ./hardware-configuration.nix", artifacts["configuration_module"])
        self.assertIn("    ./nixpi-install.nix", artifacts["configuration_module"])
        self.assertIn('networking.hostName = "pi-box";', artifacts["configuration_module"])

    def test_main_prints_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            nixos_etc = root / "etc/nixos"
            nixos_etc.mkdir(parents=True)
            (nixos_etc / "configuration.nix").write_text(
                "{\n  imports = [\n    ./hardware-configuration.nix\n  ];\n}\n",
                encoding="utf-8",
            )

            argv = ["nixpi-installer", "--root", tmpdir, "--hostname", "pi-box", "--primary-user", "alex", "--password", "supersecret"]
            with mock.patch("sys.argv", argv):
                with mock.patch("builtins.print") as print_mock:
                    self.module.main()

            payload = json.loads(print_mock.call_args[0][0])
            self.assertEqual(payload["hostname"], "pi-box")


if __name__ == "__main__":
    unittest.main()
