---
layout: home

hero:
  name: NixPI
  text: Headless AI companion OS on NixOS
  tagline: A simple, self-hosted system for running Pi on a VPS you control.
  image:
    src: /nixpi-mark.svg
    alt: NixPI
  actions:
    - theme: brand
      text: Install
      link: /install
    - theme: alt
      text: Getting Started
      link: /getting-started/
    - theme: alt
      text: Architecture
      link: /architecture/

features:
  - title: VPS-first and headless
    details: Deploy to a remote NixOS-capable VPS and operate through SSH plus the shell-first Pi runtime.
  - title: Installed host flake
    details: Install the final host configuration directly; the installed `/etc/nixos` flake is the running host's source of truth.
  - title: Optional operator checkout
    details: Keep `/srv/nixpi` only if you want the conventional sync-and-rebuild operator workflow.
  - title: Minimal by default
    details: Keep the base system small and evolve it with Pi runtime extensions.
  - title: Operable
    details: Built around NixOS, systemd, and file-native state for inspection and recovery.
---

## Start here

- [Install](./install)
- [Getting Started](./getting-started/)
- [Operations](./operations/)
- [Reference](./reference/)
