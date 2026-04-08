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
    ./terminal-ui.nix
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
    ./terminal-ui.nix
    ./shell.nix
  ];
}
