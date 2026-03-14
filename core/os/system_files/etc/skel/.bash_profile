# Source .bashrc for env vars (BLOOM_DIR, PATH, etc.)
[ -f ~/.bashrc ] && . ~/.bashrc

# First-boot wizard (runs once, before Pi)
if [ -t 0 ] && [ ! -f "$HOME/.bloom/.setup-complete" ]; then
  /usr/local/bin/bloom-wizard.sh
fi

# Start Pi on interactive login (only after setup, only one instance — atomic mkdir lock)
# The pi-daemon runs independently via systemd — no stop/start needed.
if [ -t 0 ] && [ -f "$HOME/.bloom/.setup-complete" ] && [ -z "$PI_SESSION" ] && mkdir /tmp/.bloom-pi-session 2>/dev/null; then
  trap 'rmdir /tmp/.bloom-pi-session 2>/dev/null' EXIT
  export PI_SESSION=1
  /usr/local/bin/bloom-greeting.sh
  exec pi
fi
