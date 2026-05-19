{
  config,
  lib,
  pkgs,
  ...
}:
let
  port = 8080;
  tailnetHost = "nazar.ojos-sargas.ts.net";
  siteRoot = pkgs.writeTextDir "index.html" ''
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Nazar Apps</title>
        <style>
          :root {
            color-scheme: dark;
            --bg: #080b10;
            --panel: #111827;
            --panel-2: #0f172a;
            --text: #e5e7eb;
            --muted: #94a3b8;
            --accent: #38bdf8;
            --accent-2: #a78bfa;
            --ok: #34d399;
            --warn: #fbbf24;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }

          * { box-sizing: border-box; }

          body {
            margin: 0;
            min-height: 100vh;
            background:
              radial-gradient(circle at 20% 20%, rgba(56, 189, 248, 0.16), transparent 32rem),
              radial-gradient(circle at 80% 0%, rgba(167, 139, 250, 0.16), transparent 34rem),
              var(--bg);
            color: var(--text);
          }

          main {
            width: min(1120px, calc(100% - 32px));
            margin: 0 auto;
            padding: 56px 0;
          }

          header {
            display: flex;
            justify-content: space-between;
            gap: 24px;
            align-items: flex-end;
            margin-bottom: 32px;
          }

          h1 {
            margin: 0 0 10px;
            font-size: clamp(2.2rem, 8vw, 5rem);
            letter-spacing: -0.08em;
            line-height: 0.9;
          }

          .subtitle {
            max-width: 760px;
            margin: 0;
            color: var(--muted);
            font-size: 1.05rem;
            line-height: 1.55;
          }

          .badge {
            white-space: nowrap;
            border: 1px solid rgba(148, 163, 184, 0.24);
            background: rgba(15, 23, 42, 0.72);
            color: var(--muted);
            border-radius: 999px;
            padding: 10px 14px;
            font-size: 0.9rem;
          }

          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 16px;
          }

          .card {
            display: flex;
            min-height: 210px;
            flex-direction: column;
            justify-content: space-between;
            padding: 22px;
            border-radius: 24px;
            border: 1px solid rgba(148, 163, 184, 0.18);
            background: linear-gradient(145deg, rgba(17, 24, 39, 0.94), rgba(15, 23, 42, 0.78));
            box-shadow: 0 22px 70px rgba(0, 0, 0, 0.25);
            text-decoration: none;
            color: inherit;
            transition: transform 150ms ease, border-color 150ms ease, background 150ms ease;
          }

          .card:hover {
            transform: translateY(-2px);
            border-color: rgba(56, 189, 248, 0.48);
            background: linear-gradient(145deg, rgba(17, 24, 39, 1), rgba(30, 41, 59, 0.86));
          }

          .card.disabled {
            opacity: 0.72;
            cursor: default;
          }

          .card.disabled:hover {
            transform: none;
            border-color: rgba(148, 163, 184, 0.18);
          }

          .eyebrow {
            display: inline-flex;
            width: max-content;
            gap: 8px;
            align-items: center;
            margin-bottom: 18px;
            border-radius: 999px;
            background: rgba(56, 189, 248, 0.10);
            color: #bae6fd;
            padding: 6px 10px;
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          .eyebrow.planned { background: rgba(251, 191, 36, 0.11); color: #fde68a; }
          .eyebrow.files { background: rgba(52, 211, 153, 0.10); color: #bbf7d0; }

          h2 {
            margin: 0 0 10px;
            font-size: 1.45rem;
            letter-spacing: -0.03em;
          }

          .card p {
            margin: 0;
            color: var(--muted);
            line-height: 1.45;
          }

          .url {
            margin-top: 22px;
            color: var(--accent);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
            font-size: 0.84rem;
            overflow-wrap: anywhere;
          }

          footer {
            margin-top: 28px;
            padding: 18px 2px 0;
            color: var(--muted);
            font-size: 0.92rem;
            line-height: 1.5;
          }

          code {
            color: #c4b5fd;
            background: rgba(167, 139, 250, 0.12);
            border-radius: 6px;
            padding: 2px 5px;
          }

          @media (max-width: 760px) {
            header { display: block; }
            .badge { display: inline-flex; margin-top: 18px; }
          }
        </style>
      </head>
      <body>
        <main>
          <header>
            <div>
              <h1>Nazar Apps</h1>
              <p class="subtitle">
                Private directory for web services running on Nazar. This page is intended for Tailscale access only.
              </p>
            </div>
            <div class="badge">nazar · ${tailnetHost}:${toString port}</div>
          </header>

          <section class="grid" aria-label="Available Nazar web apps">
            <a class="card" href="http://127.0.0.1:9119/">
              <div>
                <span class="eyebrow">local tunnel</span>
                <h2>Hermes Web Dashboard</h2>
                <p>Hermes Agent dashboard. It currently binds to localhost on Nazar, so this link is for the existing laptop SSH tunnel.</p>
              </div>
              <div class="url">http://127.0.0.1:9119/</div>
            </a>

            <a class="card files" href="http://${tailnetHost}/life/">
              <div>
                <span class="eyebrow files">webdav</span>
                <h2>Life OS Files</h2>
                <p>Browse the WebDAV-backed Life OS file root. Obsidian and DAV clients use this same standards-first storage.</p>
              </div>
              <div class="url">http://${tailnetHost}/life/</div>
            </a>

            <a class="card" href="http://${tailnetHost}:5232/">
              <div>
                <span class="eyebrow files">caldav/carddav</span>
                <h2>Radicale</h2>
                <p>CalDAV/CardDAV endpoint for calendars, contacts, and VTODO reminders consumed by Thunderbird and vdirsyncer.</p>
              </div>
              <div class="url">http://${tailnetHost}:5232/</div>
            </a>

            <div class="card disabled" aria-disabled="true">
              <div>
                <span class="eyebrow planned">planned</span>
                <h2>Life OS Web Dashboard</h2>
                <p>Planned single-page human dashboard over the canonical <code>/srv/life</code> files. The implementation plan is in the repo.</p>
              </div>
              <div class="url">future: http://${tailnetHost}:9120/</div>
            </div>
          </section>

          <footer>
            Keep this boring: directory only, no canonical data. The actual sources of truth remain Hermes state, Radicale, and <code>/srv/life</code>.
          </footer>
        </main>
      </body>
    </html>
  '';
in
{
  services.nginx = {
    enable = true;

    virtualHosts."nazar-app-directory" = {
      listen = [
        {
          addr = "0.0.0.0";
          inherit port;
        }
      ];

      root = siteRoot;

      locations."/" = {
        index = "index.html";
        tryFiles = "$uri $uri/ /index.html";
        extraConfig = ''
          add_header X-Robots-Tag "noindex, nofollow" always;
        '';
      };
    };
  };

  networking.firewall.interfaces.tailscale0.allowedTCPPorts = [ port ];

  assertions = [
    {
      assertion = lib.elem port (config.networking.firewall.interfaces.tailscale0.allowedTCPPorts or [ ]);
      message = "Nazar app directory expects TCP/${toString port} to be allowed on tailscale0.";
    }
    {
      assertion = !(lib.elem port (config.networking.firewall.allowedTCPPorts or [ ]));
      message = "Nazar app directory must not expose TCP/${toString port} globally.";
    }
  ];
}
