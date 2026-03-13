#!/bin/bash
set -xeuo pipefail

# Global CLI tools (pinned versions)
HOME=/tmp npm install -g --cache /tmp/npm-cache \
    "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    "@mariozechner/pi-coding-agent@${PI_CODING_AGENT_VERSION}" \
    "@biomejs/biome@${BIOME_VERSION}" \
    "typescript@${TYPESCRIPT_VERSION}"

# Bloom package dependencies (cached — only re-runs when package.json changes)
cd /usr/local/share/bloom
HOME=/tmp npm install --cache /tmp/npm-cache

rm -rf /var/roothome/.npm /root/.npm
