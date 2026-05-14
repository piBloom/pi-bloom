#!/bin/bash
# Deploy the multi-workspace nixpi architecture to nazar.
# Run this from the nazar host as root.

set -euo pipefail

cd /root/nazar

echo "=== Pulling latest nazar config ==="
git pull

echo "=== Deploying nazar host ==="
nixos-rebuild switch --flake .#nazar

echo "=== Deploying VMs (for new admin-keys.nix) ==="
nix run .#deploy-all

echo "=== Checking nixpi service ==="
systemctl status nixpi

echo "=== Checking nginx vhost for nixpi.nazar.studio ==="
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4815/ || true
echo

echo "=== Testing SSH to minecraft VM ==="
ssh -o StrictHostKeyChecking=accept-new -T alex@10.10.10.30 echo "minecraft SSH OK" || echo "FAILED: check SSH keys"

echo ""
echo "=== Next steps ==="
echo "1. Add DNS A record: nixpi.nazar.studio → 167.235.12.22"
echo "2. Open http://nixpi.nazar.studio through sshuttle"
echo "3. Test workspace switching in the UI"
