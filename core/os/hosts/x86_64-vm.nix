# core/os/hosts/x86_64-vm.nix
# Local headless VM/dev host. Pre-authorizes the committed dev key so agents
# and developers can SSH in from first boot without any wizard interaction.
{ ... }:

{
  imports = [ ./x86_64.nix ];

  # Pre-authorize the committed dev keypair for passwordless agent SSH.
  # tools/dev-key is intentionally committed — this is a dev-only VM.
  users.users.pi.openssh.authorizedKeys.keyFiles = [ ../../../tools/dev-key.pub ];

  # VM dev share: mount host's ~/.nixpi into /mnt/host-nixpi via 9p virtfs.
  fileSystems."/mnt/host-nixpi" = {
    device = "host-nixpi";
    fsType = "9p";
    options = [ "trans=virtio" "ro" "nofail" ];
  };
}
