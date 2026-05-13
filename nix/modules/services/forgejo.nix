{
  lib,
  pkgs,
  vm,
  ...
}:
{
  services.forgejo = {
    enable = true;
    package = pkgs.forgejo-lts;
    database.type = "sqlite3";

    settings = {
      DEFAULT = {
        APP_NAME = "Nazar Git";
        RUN_MODE = "prod";
      };

      server = {
        DOMAIN = vm.dns;
        ROOT_URL = "http://${vm.dns}/";
        HTTP_ADDR = "0.0.0.0";
        HTTP_PORT = vm.webPort;

        DISABLE_SSH = false;
        START_SSH_SERVER = true;
        BUILTIN_SSH_SERVER_USER = "git";
        SSH_LISTEN_HOST = "0.0.0.0";
        SSH_LISTEN_PORT = vm.sshPort;
        SSH_PORT = vm.sshPort;
      };

      service = {
        DISABLE_REGISTRATION = true;
        REQUIRE_SIGNIN_VIEW = true;
      };

      repository = {
        DEFAULT_BRANCH = "main";
        DEFAULT_PRIVATE = "private";
        FORCE_PRIVATE = true;
      };

      actions.ENABLED = false;
      log.LEVEL = "Info";
    };
  };

  networking.firewall.allowedTCPPorts = [
    vm.webPort
    vm.sshPort
  ];

  assertions = [
    {
      assertion = vm.service == "forgejo";
      message = "The Forgejo module should only be imported by the git/Forgejo VM.";
    }
  ];
}
