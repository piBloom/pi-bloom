# Zellij as Default SSH Terminal Experience

**Date**: 2026-03-12
**Status**: Draft

## Problem

Bloom currently ships tmux as the terminal multiplexer for SSH sessions. While functional, tmux has a steep learning curve — its prefix-key model, arcane keybindings, and lack of built-in discoverability make it unfriendly for new users. Bloom needs a terminal experience that is persistent, discoverable, and provides a curated "workstation" feel on SSH.

## Solution

Replace tmux with Zellij as the sole terminal multiplexer. Auto-launch Zellij on interactive SSH sessions with a predefined tab-based layout. Provide an escape hatch for scripting and non-interactive use.

## Design

### Package Changes

- **Remove**: `tmux` from `os/packages/packages-install.txt`
- **Add**: `zellij` (available in Fedora 42 repos, no custom repo needed)

### Shell Profile Integration

Zellij launches from `.bash_profile` using a guard-based approach. The modified file:

```bash
# Source .bashrc for env vars (BLOOM_DIR, PATH, etc.)
[ -f ~/.bashrc ] && . ~/.bashrc

# Auto-launch Zellij on interactive SSH login (skip if escape hatch or already inside Zellij)
# Guards: interactive TTY, SSH session, not already in Zellij, no escape hatch env var
if [ -t 0 ] && [ -n "$SSH_CONNECTION" ] && [ -z "$ZELLIJ" ] && [ -z "$BLOOM_NO_ZELLIJ" ]; then
  exec zellij attach bloom --create --layout bloom
fi

# Start Pi on interactive login (only one instance — atomic mkdir lock)
# The pi-daemon runs independently via systemd — no stop/start needed.
if [ -t 0 ] && [ -z "$PI_SESSION" ] && mkdir /tmp/.bloom-pi-session 2>/dev/null; then
  trap 'rmdir /tmp/.bloom-pi-session 2>/dev/null' EXIT
  export PI_SESSION=1
  /usr/local/bin/bloom-greeting.sh
  exec pi
fi
```

**Flow**:
1. Source env vars from `.bashrc`
2. If interactive + SSH session + not inside Zellij + no escape hatch → `exec zellij attach --create --layout bloom`
3. Zellij attaches to an existing session (if one exists) or creates a new session with the bloom layout
4. On new session: Zellij spawns Tab 1 with `bash -l` → `.bash_profile` re-runs → `$ZELLIJ` is set, step 2 skipped → falls through to Pi launch block
5. On attach: Zellij restores previous session state (no `.bash_profile` re-run needed)

**SSH-only guard**: The `$SSH_CONNECTION` check ensures Zellij only launches over SSH. Physical console login (getty autologin on tty1) and serial console access skip Zellij and go straight to the Pi TUI as before. Note: `ssh pi@localhost` from within the machine will trigger Zellij — this is correct behavior since it's still an SSH session.

**SCP/SFTP safety**: SCP and SFTP sessions do not allocate a TTY, so `[ -t 0 ]` returns false and the Zellij block is skipped. The `$SSH_CONNECTION` var is set for SCP/SFTP, but the `[ -t 0 ]` guard provides the necessary protection.

**Escape hatches**:
- `BLOOM_NO_ZELLIJ=1 ssh pi@host` — skips Zellij, drops to plain bash + Pi
- `ssh pi@host -- <command>` — runs command directly (non-login, non-interactive), no Zellij

### Zellij Layout

A KDL layout file shipped at `etc/skel/.config/zellij/layouts/bloom.kdl`:

```kdl
layout {
    tab name="Pi" focus=true {
        pane command="bash" {
            args "-l"
        }
    }
    tab name="Shell" {
        pane command="bash"
    }
    tab name="Logs" {
        pane command="journalctl" {
            args "--user" "-f"
        }
    }
}
```

**Pane shell types**:
- **Tab 1 "Pi"**: Runs `bash -l` (login shell) → sources `.bash_profile` → `$ZELLIJ` is set so Zellij guard is skipped → hits Pi launch block → greeting + `exec pi`
- **Tab 2 "Shell"**: Explicit `command="bash"` (no `-l` flag) runs bash as a non-login shell → `.bash_profile` is NOT sourced → plain shell prompt, no Pi auto-launch
- **Tab 3 "Logs"**: Runs `journalctl --user -f` directly — follows user-scoped systemd journal (Pi daemon, services)

**Pi exit behavior**: When the user quits Pi in Tab 1, the `exec pi` process ends, which closes the pane/tab. This is intentional — exiting Pi signals the user is done with that session. Tabs 2 and 3 remain available. To restart Pi, the user can open a new pane and run `pi` manually, or disconnect and reconnect to get a fresh session.

### Reconnect Behavior

The `zellij attach bloom --create --layout bloom` invocation handles reconnection using a named session ("bloom") for predictable behavior:
- **First connect (no existing session)**: Creates a new session named "bloom" with the bloom layout
- **Reconnect (session "bloom" exists)**: Attaches to the existing session, restoring its prior state
- **Session "bloom" is already attached**: Zellij shows an error; user can create a differently-named session manually

The `--layout bloom` flag only applies when creating a new session; it is ignored when attaching to an existing session. Using a named session avoids orphaned sessions accumulating after unclean disconnects.

### Zellij Configuration

No custom Zellij configuration beyond the layout file. Stock Zellij defaults provide:
- Built-in status bar with keybinding hints
- Discoverable mode-based UI
- Session persistence across disconnects
- Sensible default keybindings

Stock keybindings use `Ctrl+<key>` which may occasionally conflict with terminal applications (e.g., `Ctrl+O` in nano). This is a known Zellij trade-off accepted for the discoverability benefits. Users can customize keybindings in `~/.config/zellij/config.kdl` if needed.

## Files Changed

| File | Action |
|------|--------|
| `os/packages/packages-install.txt` | Replace `tmux` with `zellij` |
| `os/system_files/etc/skel/.bash_profile` | Add Zellij auto-launch guard |
| `os/system_files/etc/skel/.config/zellij/layouts/bloom.kdl` | New — tab layout |

## Not In Scope

- Custom Zellij themes or branding
- Zellij plugins
- Custom keybinding configuration
- Multiple layout options
- tmux compatibility layer or fallback
- Stale Pi session lock cleanup (pre-existing concern, not introduced by this change)
