{ ... }:
let
  aspects = ../../aspects;
in
{
  imports = [ (aspects + "/profiles/client-alex-laptop/default.nix") ];
}
