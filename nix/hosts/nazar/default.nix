{ ... }:
let
  aspects = ../../aspects;
in
{
  imports = [ (aspects + "/profiles/host-production/default.nix") ];
}
