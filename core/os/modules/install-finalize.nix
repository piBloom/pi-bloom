{
  warnings = [
    ''
      core/os/modules/install-finalize.nix is obsolete. Install the final host
      configuration directly; NixPI no longer seeds /srv/nixpi or generates
      /etc/nixos/flake.nix at boot.
    ''
  ];
}
