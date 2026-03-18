#!/usr/bin/env python3
# bloom_prefill/main.py
# Calamares job module: writes Bloom OS first-boot configuration to the target.
# Runs after nixos-install and before umount.
#
# Writes to target:
#   ~pi/.bloom/prefill.env      — first-boot automation config
#   ~pi/.bloom/pi-bloom/        — cloned repo for easy nixos-rebuild
#   ~pi/.pi/agent/settings.json — AI provider config for pi-daemon
#   ~pi/.gitconfig              — git name from Calamares fullName (no email at install time)
#   /etc/NetworkManager/system-connections/*.nmconnection — WiFi credentials

import glob
import json
import os
import shutil
import subprocess
import libcalamares

# UID/GID 1000 is hardcoded: the live ISO has no 'pi' user in /etc/passwd
# (pwd.getpwnam("pi") would raise KeyError). NixOS deterministically assigns
# UID 1000 to the first normal user declared in users.users.
PI_UID = 1000
PI_GID = 1000


def pretty_name():
    return "Writing Bloom configuration"


def _makedirs_owned(path):
    """Create directory tree with pi ownership on all newly created components."""
    parts = []
    current = path
    while not os.path.exists(current):
        parts.append(current)
        current = os.path.dirname(current)
    os.makedirs(path, exist_ok=True)
    for part in reversed(parts):
        os.chown(part, PI_UID, PI_GID)


def _write_owned(path, content, mode=0o600):
    """Write file with pi ownership and restricted permissions."""
    _makedirs_owned(os.path.dirname(path))
    with open(path, "w") as f:
        f.write(content)
    os.chmod(path, mode)
    os.chown(path, PI_UID, PI_GID)


def run():
    gs = libcalamares.globalstorage
    root = gs.value("rootMountPoint") or "/mnt"
    # fullName / username come from the Calamares users page (show phase).
    # username is what the user typed — it becomes the system username via
    # bloom.username in host-config.nix (bloom-shell.nix declares the account).
    git_name    = gs.value("fullName")  or ""
    username    = gs.value("username")  or "pi"
    matrix_user = username
    git_email   = ""
    netbird_key = ""
    services    = ""

    # Home directory matches the username the installer will create.
    user_home = os.path.join(root, "home", username)

    def _shell_quote(value: str) -> str:
        """Wrap value in single quotes for safe shell sourcing; escape embedded single quotes."""
        return "'" + value.replace("'", "'\\''") + "'"

    # ── User password ─────────────────────────────────────────────────────────
    # Extract the password from GS early so we can include PREFILL_MATRIX_PASSWORD
    # in prefill.env when Calamares stored a plaintext password.
    # The Calamares users exec module is NOT in the sequence (it would call
    # `usermod <typed-username>` which fails because only "pi" exists).
    # We set the password directly using the value the users view module stored.
    users_list = gs.value("users") or []
    password_value = ""
    if users_list and isinstance(users_list, list):
        first = users_list[0]
        if isinstance(first, dict):
            password_value = first.get("password", "")

    # Calamares may store the password as plaintext or as a crypt hash.
    # Hashes always start with '$' (e.g. $6$..., $y$..., $2b$...).
    password_is_hash = password_value.startswith("$") if password_value else False

    # ── prefill.env ──────────────────────────────────────────────────────────
    prefill_dir  = os.path.join(user_home, ".bloom")
    prefill_path = os.path.join(prefill_dir, "prefill.env")
    _makedirs_owned(prefill_dir)

    # Use username as fallback for git name if fullName was not entered.
    prefill_name = git_name or username

    prefill_content = (
        f"PREFILL_NETBIRD_KEY={_shell_quote(netbird_key)}\n"
        f"PREFILL_USERNAME={_shell_quote(matrix_user)}\n"
        f"PREFILL_NAME={_shell_quote(prefill_name)}\n"
        f"PREFILL_EMAIL={_shell_quote(git_email)}\n"
        f"PREFILL_SERVICES={_shell_quote(services)}\n"
        # Password was set in Calamares — tell the wizard to skip the password step.
        "PREFILL_PASSWORD_DONE='1'\n"
    )
    # If plaintext is available, pre-fill the Matrix password with the same value
    # so the user's Matrix account uses the same password as their login.
    if password_value and not password_is_hash:
        prefill_content += f"PREFILL_MATRIX_PASSWORD={_shell_quote(password_value)}\n"

    _write_owned(prefill_path, prefill_content, mode=0o600)
    libcalamares.utils.debug(f"bloom_prefill: wrote {prefill_path}")

    # ── settings.json ────────────────────────────────────────────────────────
    settings_dir  = os.path.join(user_home, ".pi", "agent")
    settings_path = os.path.join(settings_dir, "settings.json")
    _makedirs_owned(settings_dir)

    settings = {
        "packages": ["/usr/local/share/bloom"],
        "defaultProvider": "localai",
        "defaultModel": "Qwen3.5-4B-Q4_K_M",
        "defaultThinkingLevel": "medium",
    }
    _write_owned(settings_path, json.dumps(settings, indent=2) + "\n", mode=0o600)
    libcalamares.utils.debug(f"bloom_prefill: wrote {settings_path}")

    # ── .gitconfig ───────────────────────────────────────────────────────────
    if git_name and git_email:
        gitconfig_path = os.path.join(user_home, ".gitconfig")
        gitconfig = f"[user]\n    name = {git_name}\n    email = {git_email}\n"
        _write_owned(gitconfig_path, gitconfig, mode=0o644)
        libcalamares.utils.debug(f"bloom_prefill: wrote {gitconfig_path}")

    # ── Apply user password ───────────────────────────────────────────────────
    if password_value:
        cmd = ["chpasswd", "--root", root]
        if password_is_hash:
            cmd.append("--encrypted")
        chpasswd = subprocess.run(
            cmd,
            input=f"{username}:{password_value}\n",
            capture_output=True, text=True,
        )
        if chpasswd.returncode != 0:
            libcalamares.utils.warning(
                f"bloom_prefill: chpasswd failed (exit {chpasswd.returncode}): {chpasswd.stderr.strip()}"
            )
        else:
            libcalamares.utils.debug(f"bloom_prefill: set {username} password")
    else:
        libcalamares.utils.warning(f"bloom_prefill: no password in globalstorage — {username} will have no password")

    # ── Clone pi-bloom repo ─────────────────────────────────────────────────
    # Clone the repo so users can easily rebuild without re-downloading
    bloom_repo_dir = os.path.join(user_home, ".bloom", "pi-bloom")
    try:
        _makedirs_owned(os.path.dirname(bloom_repo_dir))
        clone_cmd = [
            "git", "clone", "--depth", "1",
            "https://github.com/alexradunet/piBloom.git",
            bloom_repo_dir
        ]
        clone_result = subprocess.run(
            clone_cmd,
            capture_output=True,
            text=True,
            cwd=os.path.dirname(bloom_repo_dir)
        )
        if clone_result.returncode == 0:
            # Fix ownership of cloned repo (git clone creates as root in chroot)
            for dirpath, dirnames, filenames in os.walk(bloom_repo_dir):
                os.chown(dirpath, PI_UID, PI_GID)
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    if os.path.exists(fp):
                        os.chown(fp, PI_UID, PI_GID)
            libcalamares.utils.debug(f"bloom_prefill: cloned repo to {bloom_repo_dir}")
        else:
            libcalamares.utils.warning(
                f"bloom_prefill: git clone failed: {clone_result.stderr.strip()}"
            )
    except Exception as e:
        # Non-fatal: user can clone manually later
        libcalamares.utils.warning(f"bloom_prefill: repo clone failed: {e}")

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
