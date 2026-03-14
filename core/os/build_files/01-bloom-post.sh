#!/bin/bash
set -xeuo pipefail

cd /usr/local/share/bloom

# Build TypeScript and prune dev deps. Keep this phase offline-safe for
# bootc-image-builder by reusing the npm cache populated in 01-bloom-fetch.sh.
npm run build
if ! HOME=/tmp npm prune --omit=dev --cache /tmp/npm-cache --prefer-offline --offline; then
	echo "warning: npm prune --omit=dev failed in offline image build; continuing with dev deps present" >&2
fi
rm -rf /tmp/npm-cache /var/roothome/.npm /root/.npm

# Wire globally-installed Pi SDK packages into Bloom's node_modules
# NOTE: linking the namespace dir itself can create a nested
# node_modules/@mariozechner/@mariozechner layout if the target exists.
# Link concrete packages instead.
rm -rf /usr/local/share/bloom/node_modules/@mariozechner
mkdir -p /usr/local/share/bloom/node_modules/@mariozechner
ln -s /usr/local/lib/node_modules/@mariozechner/pi-coding-agent /usr/local/share/bloom/node_modules/@mariozechner/pi-coding-agent
ln -s /usr/local/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai /usr/local/share/bloom/node_modules/@mariozechner/pi-ai

# Configure Pi settings defaults (immutable layer)
mkdir -p /usr/local/share/bloom/.pi/agent
echo '{"packages": ["/usr/local/share/bloom"]}' > /usr/local/share/bloom/.pi/agent/settings.json

# Back-compat runtime links for Pi package conventions.
ln -sfn /usr/local/share/bloom/core/persona /usr/local/share/bloom/persona
ln -sfn /usr/local/share/bloom/core/skills /usr/local/share/bloom/skills

# Continuwuity binary
chmod +x /usr/local/bin/continuwuity

# Appservices directory
mkdir -p /etc/bloom/appservices
