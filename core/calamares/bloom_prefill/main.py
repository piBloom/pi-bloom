#!/usr/bin/env python3
# bloom_prefill/main.py
# Calamares job module: writes Bloom OS first-boot configuration to the target.
# Runs after nixos-install and before umount.
#
# Writes to target:
#   ~pi/.bloom/prefill.env      — first-boot automation config
#   ~pi/.pi/agent/settings.json — AI provider config for pi-daemon
#   ~pi/.gitconfig              — git identity (if name+email provided)
#   /etc/NetworkManager/system-connections/*.nmconnection — WiFi credentials

import glob
import json
import os
import shutil
import libcalamares

# UID/GID 1000 is hardcoded: the live ISO has no 'pi' user in /etc/passwd
# (pwd.getpwnam("pi") would raise KeyError). NixOS deterministically assigns
# UID 1000 to the first normal user declared in users.users.
PI_UID = 1000
PI_GID = 1000


def pretty_name():
    return "Writing Bloom configuration"


def _makedirs_owned(path):
    """Create directory tree with pi ownership."""
    os.makedirs(path, exist_ok=True)
    os.chown(path, PI_UID, PI_GID)


def _write_owned(path, content, mode=0o600):
    """Write file with pi ownership and restricted permissions."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)
    os.chmod(path, mode)
    os.chown(path, PI_UID, PI_GID)


def run():
    gs = libcalamares.globalstorage
    root = gs.value("rootMountPoint") or "/mnt"
    pi_home = os.path.join(root, "home", "pi")

    netbird_key = gs.value("bloom_netbird_key")    or ""
    matrix_user = gs.value("bloom_matrix_username") or ""
    git_name    = gs.value("bloom_git_name")       or ""
    git_email   = gs.value("bloom_git_email")      or ""
    services    = gs.value("bloom_services")       or ""

    # ── prefill.env ──────────────────────────────────────────────────────────
    prefill_dir  = os.path.join(pi_home, ".bloom")
    prefill_path = os.path.join(prefill_dir, "prefill.env")
    _makedirs_owned(prefill_dir)

    prefill_content = (
        f"PREFILL_NETBIRD_KEY={netbird_key}\n"
        f"PREFILL_USERNAME={matrix_user}\n"
        f"PREFILL_NAME={git_name}\n"
        f"PREFILL_EMAIL={git_email}\n"
        f"PREFILL_SERVICES={services}\n"
    )
    _write_owned(prefill_path, prefill_content, mode=0o600)
    libcalamares.utils.debug(f"bloom_prefill: wrote {prefill_path}")

    # ── settings.json ────────────────────────────────────────────────────────
    settings_dir  = os.path.join(pi_home, ".pi", "agent")
    settings_path = os.path.join(settings_dir, "settings.json")
    _makedirs_owned(settings_dir)
    os.chown(os.path.join(pi_home, ".pi"), PI_UID, PI_GID)

    settings = {
        "packages": ["/usr/local/share/bloom"],
        "defaultProvider": "localai",
        "defaultModel": "omnicoder-9b-q4_k_m",
        "defaultThinkingLevel": "medium",
    }
    _write_owned(settings_path, json.dumps(settings, indent=2) + "\n", mode=0o600)
    libcalamares.utils.debug(f"bloom_prefill: wrote {settings_path}")

    # ── .gitconfig ───────────────────────────────────────────────────────────
    if git_name and git_email:
        gitconfig_path = os.path.join(pi_home, ".gitconfig")
        gitconfig = f"[user]\n    name = {git_name}\n    email = {git_email}\n"
        _write_owned(gitconfig_path, gitconfig, mode=0o644)
        libcalamares.utils.debug(f"bloom_prefill: wrote {gitconfig_path}")

    # ── NetworkManager WiFi connections (best-effort) ────────────────────────
    src_nm = "/etc/NetworkManager/system-connections"
    dst_nm = os.path.join(root, "etc", "NetworkManager", "system-connections")
    try:
        os.makedirs(dst_nm, exist_ok=True)
        for conn_file in glob.glob(os.path.join(src_nm, "*.nmconnection")):
            shutil.copy2(conn_file, dst_nm)
            libcalamares.utils.debug(f"bloom_prefill: copied {conn_file}")
    except Exception as e:
        # Non-fatal: user may be on ethernet, or permissions may differ
        libcalamares.utils.warning(f"bloom_prefill: NM connection copy failed: {e}")

    return None
