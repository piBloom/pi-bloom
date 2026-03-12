# Source .bashrc for env vars (BLOOM_DIR, PATH, etc.)
[ -f ~/.bashrc ] && . ~/.bashrc

# Auto-launch Zellij on interactive SSH login (skip if escape hatch or already inside Zellij)
# Guards: interactive TTY, SSH session, not already in Zellij, no escape hatch env var
if [ -t 0 ] && [ -n "$SSH_CONNECTION" ] && [ -z "$ZELLIJ" ] && [ -z "$BLOOM_NO_ZELLIJ" ]; then
  if zellij list-sessions 2>/dev/null | grep -q '^bloom$'; then
    exec zellij attach bloom
  else
    exec zellij -s bloom -l bloom
  fi
fi

# Start Pi on interactive login (only one instance — atomic mkdir lock)
# The pi-daemon runs independently via systemd — no stop/start needed.
if [ -t 0 ] && [ -z "$PI_SESSION" ] && mkdir /tmp/.bloom-pi-session 2>/dev/null; then
  trap 'rmdir /tmp/.bloom-pi-session 2>/dev/null' EXIT
  export PI_SESSION=1
  /usr/local/bin/bloom-greeting.sh
  exec pi
fi
