# core/os/modules/bloom-llm.nix
{ pkgs, lib, ... }:

let
  modelFileName = "omnicoder-9b-q4_k_m.gguf";
  model = pkgs.fetchurl {
    url    = "https://huggingface.co/Tesslate/OmniCoder-9B-GGUF/resolve/main/omnicoder-9b-q4_k_m.gguf?download=true";
    sha256 = "1cyqfd6fxm0qsmg7xxzs446rpdjrfb9p09ffzfbpkq68adr8y3jm";
    name   = modelFileName;
  };
in
{
  systemd.services.localai = {
    description = "Bloom Local AI Inference (llama-server)";
    after    = [ "network.target" ];
    wants    = [ "network.target" ];
    wantedBy = [ "multi-user.target" ];

    serviceConfig = {
      Type             = "simple";
      ExecStartPre     = "${pkgs.writeShellScript ''localai-seed-model'' ''
        dest=/var/lib/localai/models/${modelFileName}
        if [ ! -f "$dest" ]; then
          install -m 644 ${model} "$dest"
        fi
      ''}";
      ExecStart        = "${pkgs.llama-cpp}/bin/llama-server --host 0.0.0.0 --port 11435 --model /var/lib/localai/models/${modelFileName}";
      Restart          = "on-failure";
      RestartSec       = 5;
      DynamicUser      = true;
      StateDirectory   = "localai localai/models";
      WorkingDirectory = "/var/lib/localai";
    };
  };
}
