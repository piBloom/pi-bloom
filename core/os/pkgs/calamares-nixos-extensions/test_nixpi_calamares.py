import importlib.util
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock


def load_module():
    module_path = os.environ.get(
        "NIXPI_CALAMARES_HELPER",
        str(Path(__file__).with_name("nixpi_calamares.py")),
    )
    spec = importlib.util.spec_from_file_location("nixpi_calamares", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NixpiCalamaresTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.template_path = Path(__file__).with_name("nixpi-install-module.nix.in")
        self.original_template_path = self.module.NIXPI_INSTALL_MODULE_TEMPLATE_PATH
        self.module.NIXPI_INSTALL_MODULE_TEMPLATE_PATH = str(self.template_path)

    def tearDown(self):
        self.module.NIXPI_INSTALL_MODULE_TEMPLATE_PATH = self.original_template_path

    def test_prepare_artifacts_enables_flakes_and_renders_values(self):
        cfg = "{\n  imports =\n    [ # Include the results of the hardware scan.\n      ./hardware-configuration.nix\n      ./nixpi-install.nix\n    ];\n}\n"
        artifacts = self.module.prepare_nixpi_install_artifacts(
            "/mnt/target",
            {"username": "alex", "hostname": "pi-box"},
            cfg,
        )

        self.assertEqual(artifacts["nixpi_install_path"], "/mnt/target/etc/nixos/nixpi-install.nix")
        self.assertEqual(artifacts["nixpi_host_path"], "/mnt/target/etc/nixos/nixpi-host.nix")
        self.assertEqual(artifacts["flake_path"], "/mnt/target/etc/nixos/flake.nix")
        self.assertEqual(artifacts["flake_install_ref"], "/mnt/target/etc/nixos#pi-box")
        self.assertIn('nix.settings.experimental-features = [ "nix-command" "flakes" ];', artifacts["nixpi_install_module"])
        self.assertTrue(artifacts["nixpi_install_module"].startswith("{ pkgs, ... }:"))
        self.assertIn('piAgent = pkgs.callPackage ./nixpi/core/os/pkgs/pi {};', artifacts["nixpi_install_module"])
        self.assertIn('_module.args = { inherit piAgent appPackage; };', artifacts["nixpi_install_module"])
        self.assertIn('nixosConfigurations."pi-box"', artifacts["nixpi_flake"])
        self.assertNotIn('github:alexradunet/NixPI', artifacts["nixpi_flake"])
        self.assertIn('piAgent = pkgs.callPackage ./nixpi/core/os/pkgs/pi {};', artifacts["nixpi_flake"])
        self.assertIn('./nixpi/core/os/modules/firstboot.nix', artifacts["nixpi_flake"])
        self.assertNotIn("./nixpi-install.nix", artifacts["host_cfg"])

    def test_write_artifacts_copies_tree_and_writes_expected_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source_dir = Path(tmpdir) / "source"
            source_dir.mkdir()
            (source_dir / "README.md").write_text("nixpi", encoding="utf-8")

            self.module.NIXPI_SOURCE = str(source_dir)
            writes = []
            privileged_commands = []

            def fake_host_env_process_output(argv, _stdin, content=None):
                writes.append((argv, content))
                raise AssertionError(f"unexpected command: {argv!r}")

            def fake_check_output(argv, stderr=None):
                privileged_commands.append(argv)
                if argv[:3] == ["pkexec", "rm", "-rf"]:
                    shutil.rmtree(argv[-1], ignore_errors=True)
                    return b""
                if argv[:3] == ["pkexec", "mkdir", "-p"]:
                    Path(argv[-1]).mkdir(parents=True, exist_ok=True)
                    return b""
                if argv[:3] == ["pkexec", "cp", "-a"]:
                    shutil.copytree(argv[-2], argv[-1], symlinks=True, dirs_exist_ok=True)
                    return b""
                if argv[:4] == ["pkexec", "install", "-D", "-m"]:
                    Path(argv[-1]).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(argv[-2], argv[-1])
                    return b""
                raise AssertionError(f"unexpected privileged command: {argv!r}")

            cfg = "{\n      ./nixpi-install.nix\n}\n"
            with mock.patch.object(self.module.subprocess, "check_output", side_effect=fake_check_output):
                artifacts = self.module.write_nixpi_install_artifacts(
                    tmpdir,
                    {"username": "alex", "hostname": "pi-box"},
                    cfg,
                    fake_host_env_process_output,
                )

            copied = Path(artifacts["nixpi_source_target"]) / "README.md"
            self.assertTrue(copied.exists())
            self.assertEqual(copied.read_text(encoding="utf-8"), "nixpi")
            self.assertEqual(len(privileged_commands), 6)
            self.assertEqual(len(writes), 0)
            self.assertTrue(Path(artifacts["nixpi_install_path"]).exists())
            self.assertTrue(Path(artifacts["nixpi_host_path"]).exists())
            self.assertTrue(Path(artifacts["flake_path"]).exists())


if __name__ == "__main__":
    unittest.main()
