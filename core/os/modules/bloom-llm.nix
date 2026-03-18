# core/os/modules/bloom-llm.nix
{ pkgs, lib, ... }:

let
  modelFileName = "omnicoder-9b-q4_k_m.gguf";
  modelUrl      = "https://huggingface.co/Tesslate/OmniCoder-9B-GGUF/resolve/main/omnicoder-9b-q4_k_m.gguf?download=true";
in
{
  # Static localai user shared by localai-download and localai services.
  # DynamicUser cannot be shared across two services, and both need write
  # access to /var/lib/localai/models.
  users.users.localai = { isSystemUser = true; group = "localai"; };
  users.groups.localai = {};

  systemd.tmpfiles.rules = [
    "d /var/lib/localai        0750 localai localai -"
    "d /var/lib/localai/models 0750 localai localai -"
  ];

  # ── Model download (oneshot, first-boot) ─────────────────────────────────
  # Downloads the GGUF model to the state directory on first boot.
  # On subsequent boots the model already exists and this exits immediately.
  # localai.service requires this unit, so inference only starts once the
  # model is present.  The model is NOT part of the NixOS closure.
  systemd.services.localai-download = {
    description = "Download Bloom AI Model";
    after  = [ "network-online.target" ];
    wants  = [ "network-online.target" ];
    serviceConfig = {
      Type            = "oneshot";
      RemainAfterExit = true;
      User            = "localai";
      TimeoutStartSec = "7200";   # 2-hour ceiling for slow connections
      ExecStart       = pkgs.writeShellScript "localai-download" ''
        dest=/var/lib/localai/models/${modelFileName}
        if [ -f "$dest" ]; then
          echo "${modelFileName} already present — skipping download"
          exit 0
        fi
        echo "Downloading ${modelFileName} (~5 GB) — this will take a while..."
        ${pkgs.curl}/bin/curl -L --retry 5 --retry-delay 10 \
          --progress-bar -o "$dest.tmp" "${modelUrl}"
        mv "$dest.tmp" "$dest"
        echo "Download complete: $dest"
      '';
    };
  };

  # ── Inference server ──────────────────────────────────────────────────────
  # Starts only after the model has been downloaded.  On first boot this
  # means localai.service is "activating" while the download runs, but this
  # does not block multi-user.target or getty.
  systemd.services.localai = {
    description = "Bloom Local AI Inference (llama-server)";
    after    = [ "network.target" "localai-download.service" ];
    wants    = [ "network.target" ];
    requires = [ "localai-download.service" ];
    wantedBy = [ "multi-user.target" ];

    serviceConfig = {
      Type             = "simple";
      User             = "localai";
      ExecStart        = "${pkgs.llama-cpp}/bin/llama-server --host 0.0.0.0 --port 11435 --model /var/lib/localai/models/${modelFileName}";
      Restart          = "on-failure";
      RestartSec       = 5;
      WorkingDirectory = "/var/lib/localai";
    };
  };
}
