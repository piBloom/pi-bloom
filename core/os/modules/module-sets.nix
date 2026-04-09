{
  nixpiBaseNoShell = [
    ./options.nix
    ./network.nix
    ./update.nix
  ];

  nixpiBase = [
    ./options.nix
    ./network.nix
    ./update.nix
    ./shell.nix
  ];

  nixpiNoShell = [
    ./options.nix
    ./network.nix
    ./update.nix
    ./app.nix
    ./broker.nix
    ./tooling.nix
  ];

  nixpi = [
    ./options.nix
    ./network.nix
    ./update.nix
    ./app.nix
    ./broker.nix
    ./tooling.nix
    ./shell.nix
  ];
}
