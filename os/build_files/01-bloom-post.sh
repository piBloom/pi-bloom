#!/bin/bash
set -xeuo pipefail

cd /usr/local/share/bloom

# Build TypeScript and prune dev deps
npm run build
npm prune --omit=dev

# Symlink globally-installed Pi SDK into Bloom's node_modules
ln -sf /usr/local/lib/node_modules/@mariozechner /usr/local/share/bloom/node_modules/@mariozechner

# Configure Pi settings defaults (immutable layer)
mkdir -p /usr/local/share/bloom/.pi/agent
echo '{"packages": ["/usr/local/share/bloom"]}' > /usr/local/share/bloom/.pi/agent/settings.json

# Persona directory
mkdir -p /usr/local/share/bloom/persona

# Continuwuity binary
chmod +x /usr/local/bin/continuwuity

# Appservices directory
mkdir -p /etc/bloom/appservices
