#!/usr/bin/env python3
"""Offline test harness for the bloom_nixos Calamares module.

Run from the repo root:
    python3 core/calamares/test_bloom_nixos.py

Mocks libcalamares so the config-generation logic (steps 1-3) can be
validated without a QEMU VM.  Steps 4-5 (nix build / nix copy /
nixos-install) are skipped; they still require a real NixOS live environment.

The generated files are written to /tmp/bloom-test-nixos/ and then
validated with `nix eval` if nix is available.
"""

import importlib.util
import os
import subprocess
import sys
import types

# ── Mock libcalamares ────────────────────────────────────────────────────────

class _FakeGS:
    def __init__(self, data):
        self._data = data
    def value(self, key):
        return self._data.get(key)

class _FakeUtils:
    @staticmethod
    def debug(msg):   print(f"  [debug] {msg}")
    @staticmethod
    def warning(msg): print(f"  [warn]  {msg}")

def _make_libcalamares(gs_data):
    lc = types.ModuleType("libcalamares")
    lc.globalstorage = _FakeGS(gs_data)
    lc.utils = _FakeUtils()
    return lc

# ── Test cases ───────────────────────────────────────────────────────────────

TEST_CASES = {
    "en_US": {
        "rootMountPoint":        "/tmp/bloom-test-nixos",
        "timezone":              "America/New_York",
        "locale":                "en_US.UTF-8",
        "keyboardLayout":        "us",
        "keyboardVariant":       "",
        "keyboardVConsoleKeymap":"us",
        "efiSystemPartition":    "/boot",
        "fullName":              "Test User",
        "username":              "testuser",
    },
    "bare_en_locale": {
        "rootMountPoint":        "/tmp/bloom-test-nixos",
        "timezone":              "Europe/London",
        "locale":                "en",          # ← the bug: bare language code
        "keyboardLayout":        "gb",
        "keyboardVariant":       "",
        "keyboardVConsoleKeymap":"uk",
        "efiSystemPartition":    "/boot",
        "fullName":              "Test User",
        "username":              "testuser",
    },
    "de_DE": {
        "rootMountPoint":        "/tmp/bloom-test-nixos",
        "timezone":              "Europe/Berlin",
        "locale":                "de_DE.UTF-8",
        "keyboardLayout":        "de",
        "keyboardVariant":       "nodeadkeys",
        "keyboardVConsoleKeymap":"de-latin1",
        "efiSystemPartition":    "/boot",
        "fullName":              "Hans Müller",
        "username":              "hans",
    },
    "no_efi": {
        "rootMountPoint":        "/tmp/bloom-test-nixos",
        "timezone":              "UTC",
        "locale":                "en_US.UTF-8",
        "keyboardLayout":        "us",
        "keyboardVariant":       "",
        "keyboardVConsoleKeymap":"us",
        "efiSystemPartition":    None,           # ← should return error
        "fullName":              "Test User",
        "username":              "testuser",
    },
}

# ── Driver ───────────────────────────────────────────────────────────────────

def load_module(libcalamares_mock):
    """Import bloom_nixos/main.py with the given libcalamares mock injected."""
    sys.modules["libcalamares"] = libcalamares_mock
    spec = importlib.util.spec_from_file_location(
        "bloom_nixos_main",
        os.path.join(os.path.dirname(__file__), "bloom_nixos", "main.py"),
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def validate_nix(path):
    """Try `nix eval --file <path>` and return (ok, output)."""
    try:
        r = subprocess.run(
            ["nix", "eval", "--file", path],
            capture_output=True, text=True, timeout=30,
        )
        return r.returncode == 0, (r.stderr or r.stdout).strip()
    except FileNotFoundError:
        return None, "nix not found — skipping nix eval"
    except subprocess.TimeoutExpired:
        return None, "nix eval timed out"


def run_case(name, gs_data):
    print(f"\n{'─'*60}")
    print(f"Test case: {name}")
    print(f"{'─'*60}")

    root = gs_data["rootMountPoint"]
    os.makedirs(root, exist_ok=True)

    # Monkey-patch subprocess.run so nix build / nixos-install are skipped.
    import unittest.mock as mock

    lc = _make_libcalamares(gs_data)
    mod = load_module(lc)

    skip_cmds = {
        mod.NIXOS_GENERATE_CONFIG: _fake_gen_config(root),
        "/run/current-system/sw/bin/nix": _fake_nix_cmd(root),
        mod.NIXOS_INSTALL:                _fake_nixos_install(),
    }

    original_run = subprocess.run
    def patched_run(cmd, **kwargs):
        if isinstance(cmd, list) and cmd[0] in skip_cmds:
            return skip_cmds[cmd[0]](cmd)
        return original_run(cmd, **kwargs)

    with mock.patch("subprocess.run", side_effect=patched_run):
        result = mod.run()

    if result is not None:
        title, detail = result
        print(f"  Module returned error: {title}")
        print(f"  Detail: {detail[:200]}")
        expected_error = (name == "no_efi")
        status = "PASS" if expected_error else "FAIL"
        print(f"  → {status}")
        return status == "PASS"

    # Check generated files.
    passed = True
    nixos_dir = os.path.join(root, "etc", "nixos")
    for fname in ("host-config.nix", "flake.nix"):
        fpath = os.path.join(nixos_dir, fname)
        if not os.path.exists(fpath):
            print(f"  FAIL: {fname} was not generated")
            passed = False
            continue
        with open(fpath) as f:
            content = f.read()
        print(f"\n  ── {fname} ──")
        print("  " + content.replace("\n", "\n  "))

        if fname == "host-config.nix":
            ok, msg = validate_nix(fpath)
            if ok is None:
                print(f"  [skip] {msg}")
            elif ok:
                print("  nix eval: OK")
            else:
                print(f"  nix eval FAILED: {msg[:300]}")
                passed = False

            # Verify the locale is never a bare language code.
            import re
            m = re.search(r'i18n\.defaultLocale = "([^"]+)"', content)
            if m:
                loc = m.group(1)
                if "." not in loc or "_" not in loc:
                    print(f"  FAIL: locale '{loc}' is not in xx_YY.ENC format")
                    passed = False
                else:
                    print(f"  locale format OK: {loc}")

    print(f"\n  → {'PASS' if passed else 'FAIL'}")
    return passed


# ── Fake subprocess stubs ────────────────────────────────────────────────────

def _fake_gen_config(root):
    """Stub for nixos-generate-config: write a minimal hardware-configuration.nix."""
    def _stub(cmd):
        nixos_dir = os.path.join(root, "etc", "nixos")
        os.makedirs(nixos_dir, exist_ok=True)
        hw = os.path.join(nixos_dir, "hardware-configuration.nix")
        with open(hw, "w") as f:
            f.write("{ ... }: { fileSystems.\"/\" = { device = \"/dev/vda\"; fsType = \"ext4\"; }; }\n")
        result = types.SimpleNamespace(returncode=0, stdout="", stderr="")
        return result
    return _stub

def _fake_nix_cmd(root):
    """Stub for `nix build` and `nix copy`: return a plausible store path for build."""
    def _stub(cmd):
        path = f"{root}/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-nixos-system-bloom-test"
        result = types.SimpleNamespace(returncode=0, stdout=path + "\n", stderr="")
        return result
    return _stub

def _fake_nixos_install():
    def _stub(cmd):
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")
    return _stub


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    results = {}
    for name, data in TEST_CASES.items():
        results[name] = run_case(name, data)

    print(f"\n{'═'*60}")
    print("Summary")
    print(f"{'═'*60}")
    for name, ok in results.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    total = len(results)
    passed = sum(1 for ok in results.values() if ok)
    print(f"\n{passed}/{total} passed")
    sys.exit(0 if passed == total else 1)
