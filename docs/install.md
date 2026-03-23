---
title: Install NixPI
description: Build the installer, boot into NixPI, and finish the first-boot flow.
---

<SectionHeading
  label="Install path"
  title="The shortest path from repository to running machine"
  lede="NixPI currently assumes a technical operator. The install flow is direct: build the installer image, boot it, run the installer, then finish the first-boot setup inside the new system."
/>

<PresentationBand
  eyebrow="Quick path"
  title="From source tree to live system"
  lede="This is the fastest public-facing install narrative. The full operational detail remains in the docs section."
>

<TerminalFrame title="Quick Install">
```bash
nix build .#installerIso

# write the generated ISO to a USB stick and boot it
sudo -i
nixpi-installer

# after reboot
setup-wizard.sh
```
</TerminalFrame>

</PresentationBand>

## What happens during setup

<div class="quick-grid">
  <div class="quick-card">
    <strong>1. Build the installer</strong>
    The repository produces a NixPI installer ISO through the flake output.
  </div>
  <div class="quick-card">
    <strong>2. Boot the live environment</strong>
    Use the generated image on a USB stick or test it inside a VM first.
  </div>
  <div class="quick-card">
    <strong>3. Run the installer</strong>
    The installer prepares a minimal bootable NixPI base on the target system.
  </div>
  <div class="quick-card">
    <strong>4. Finish first boot</strong>
    The wizard brings up WiFi, prefers it over Ethernet when both are available, clones `~/nixpi`, writes `/etc/nixos`, and promotes the machine into the full appliance.
  </div>
</div>

The installed system now boots into the official NixPI Openbox desktop automatically. That desktop is intentionally minimal and agent-friendly, and it is the only supported automatic first-boot entry path: Openbox opens the NixPI terminal, the terminal runs setup if needed, and later launches Pi.

<PresentationBand
  eyebrow="After install"
  title="Operate the machine from the local checkout"
  lede="Once the system is live, you edit and sync NixPI in `~/nixpi`, while `/etc/nixos` remains the deployed host flake used for rebuilds."
>

<TerminalFrame title="Post-install workflow">
```bash
cd ~/nixpi
git fetch upstream
git rebase upstream/main
sudo nixos-rebuild switch --flake /etc/nixos#$(hostname -s)
```
</TerminalFrame>

</PresentationBand>

## Need more detail?

- [Operations: Quick Deploy](./operations/quick-deploy)
- [Operations: First Boot Setup](./operations/first-boot-setup)
- [Operations](./operations/)
