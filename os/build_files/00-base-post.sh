#!/bin/bash
set -xeuo pipefail

# Copy all system files to their filesystem locations
# (includes systemd units, presets, skel, ssh config, sudoers, etc.)
cp -avf /ctx/files/. /

# Fix permissions that git doesn't preserve
chmod 0440 /etc/sudoers.d/10-bloom
chmod +x /usr/local/bin/bloom-greeting.sh /usr/local/bin/bloom-update-check.sh /usr/local/bin/bloom-wizard.sh /usr/local/bin/bloom-gateway-lib.sh

# Apply only Bloom's preset entries (not all system presets)
systemctl preset \
    sshd.service \
    netbird.service \
    bloom-matrix.service \
    bloom-update-check.timer

# Mask upstream auto-update timer (we have our own)
systemctl mask bootc-fetch-apply-updates.timer

# Mask unused NFS services
systemctl mask rpcbind.service rpcbind.socket rpc-statd.service

# OS branding
sed -i 's|^PRETTY_NAME=.*|PRETTY_NAME="Bloom OS"|' /usr/lib/os-release

# Remove empty NetBird state files (prevents JSON parse crash on boot)
rm -f /var/lib/netbird/active_profile.json /var/lib/netbird/default.json

# Firewall: trust NetBird tunnel interface
firewall-offline-cmd --zone=trusted --add-interface=wt0

# Set boot target
systemctl set-default multi-user.target
