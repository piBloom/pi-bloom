{
  inputs,
  pkgs,
  ...
}:
let
  pi = pkgs.callPackage ../../packages/pi { };
in
{
  imports = [ inputs.nixpi.nixosModules.nixpi ];

  services.nixpi = {
    enable = true;
    user = "alex";
    group = "users";
    home = "/home/alex";
    workingDirectory = "/home/alex";
    host = "127.0.0.1";
    port = 4815;
    piBinary = "${pi}/bin/pi";
  };
}
