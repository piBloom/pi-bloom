{
  inputs,
  nixpkgs,
  system,
  fleet,
  devices ? { },
}:
{
  name,
  vm,
  modules ? [ ],
}:
nixpkgs.lib.nixosSystem {
  inherit system;

  specialArgs = {
    inherit
      inputs
      fleet
      devices
      vm
      ;
  };

  modules = modules ++ [
    {
      assertions = [
        {
          assertion = vm.hostname == name;
          message = "Fleet inventory hostname must match nixosConfigurations.${name}.";
        }
      ];
    }
  ];
}
