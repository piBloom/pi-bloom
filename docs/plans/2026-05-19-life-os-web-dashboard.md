# Life OS Web Dashboard Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a small private Life OS web dashboard on Nazar that gives a browser view over the canonical Life OS data without replacing the existing standards-first storage.

**Architecture:** Add a TypeScript/Bun HTTP server inside `packages/life-os` that reads and writes the same `/srv/life` plain-file layout as the CLI, and exposes a minimal server-rendered HTML dashboard. Deploy it declaratively as a NixOS systemd service reachable only over Tailscale, behind the existing private network posture.

**Tech Stack:** TypeScript, Bun, Nix flakes/NixOS modules, systemd, plain Markdown/todo.txt/JSONL/iCalendar/vCard files. No database, no MCP, no Nextcloud, no app-specific canonical format.

---

## Product scope

### In scope for v1

- Browser dashboard reachable on the tailnet only.
- Read-only overview first:
  - today's date/time context,
  - daily journal path and latest entries,
  - open tasks from `tasks/inbox.todo` and `tasks/next.todo`,
  - recent habit log rows from `habits/log.jsonl`,
  - upcoming calendar/reminder items from Life OS `.ics` files if parser support is cheap.
- Small write actions after read-only is verified:
  - add journal entry,
  - add inbox task,
  - mark todo.txt task done,
  - log habit.
- Use existing CLI/library code paths where possible so dashboard and CLI behavior stay consistent.
- NixOS service deployed declaratively on Nazar.
- Private by network: bind to localhost/Tailscale-only reverse proxy/firewall rules and expose user-facing URLs through MagicDNS, e.g. `http://nazar.ojos-sargas.ts.net:9120/`.

### Explicitly out of scope for v1

- Authentication beyond tailnet/private network posture.
- Public internet exposure.
- Database.
- Nextcloud-style file manager.
- Rich calendar editing UI.
- Multi-user permissions.
- MCP.
- Replacing Obsidian, Thunderbird, Radicale, or WebDAV.

## Acceptance criteria

- `nix flake check --no-build` passes.
- `nix build .#checks.x86_64-linux.life-os-tests --print-build-logs` passes.
- `nix build .#nixosConfigurations.nazar.config.system.build.toplevel --print-build-logs` passes.
- After `sudo nixos-rebuild switch --flake .#nazar`, `systemctl is-active life-os-dashboard` returns `active`.
- `curl http://127.0.0.1:<port>/healthz` returns HTTP 200 and a small JSON payload.
- Tailnet URL returns the dashboard HTML.
- Dashboard reads from `/srv/life`; no separate canonical store is introduced.

---

### Task 1: Extract reusable Life OS core functions from the CLI

**Objective:** Make the CLI's filesystem operations importable by both CLI and dashboard without duplicating logic.

**Files:**
- Modify: `packages/life-os/src/life.ts`
- Test: `packages/life-os/test/life.test.ts`

**Step 1: Identify functions to export**

Export only low-level operations needed by the dashboard:

```ts
export async function ensureLayout(root: string): Promise<void> { ... }
export async function status(root: string, today: string): Promise<string> { ... }
export async function addJournal(root: string, today: string, text: string): Promise<string> { ... }
export async function taskCommand(root: string, today: string, subcommand: string | undefined, rest: string[]): Promise<CommandResult> { ... }
export async function logHabit(root: string, today: string, habitId: string | undefined, note: string): Promise<string> { ... }
```

Keep `CommandResult` exported if reused:

```ts
export type CommandResult = {
  code: number;
  stdout?: string;
  stderr?: string;
};
```

**Step 2: Run tests**

```bash
nix develop .#default --command bun test
```

Expected: existing tests pass.

**Step 3: Commit**

```bash
git add packages/life-os/src/life.ts packages/life-os/test/life.test.ts
git commit -m "refactor(life-os): export reusable core operations"
```

---

### Task 2: Add dashboard data model and read-only summary builder

**Objective:** Create a pure function that turns `/srv/life` files into dashboard data.

**Files:**
- Create: `packages/life-os/src/dashboard-data.ts`
- Create/modify: `packages/life-os/test/dashboard-data.test.ts`

**Step 1: Write failing tests**

Test with a temporary root:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDashboardData } from "../src/dashboard-data";

async function tempLifeRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "life-dashboard-"));
  await mkdir(path.join(root, "tasks"), { recursive: true });
  await mkdir(path.join(root, "journal"), { recursive: true });
  await mkdir(path.join(root, "habits"), { recursive: true });
  await writeFile(path.join(root, "tasks/inbox.todo"), "buy milk\n");
  await writeFile(path.join(root, "tasks/next.todo"), "finish dashboard\n");
  await writeFile(path.join(root, "journal/2026-05-19.md"), "# 2026-05-19\n\nTest entry\n");
  await writeFile(path.join(root, "habits/log.jsonl"), '{"date":"2026-05-19","habit":"walk","note":"20 min"}\n');
  return root;
}

describe("buildDashboardData", () => {
  test("summarizes journal, tasks, and habits", async () => {
    const root = await tempLifeRoot();
    const data = await buildDashboardData(root, "2026-05-19");
    expect(data.today).toBe("2026-05-19");
    expect(data.tasks.inbox).toContain("buy milk");
    expect(data.tasks.next).toContain("finish dashboard");
    expect(data.journalToday).toContain("Test entry");
    expect(data.recentHabits[0]?.habit).toBe("walk");
  });
});
```

**Step 2: Run test to verify failure**

```bash
nix develop .#default --command bun test packages/life-os/test/dashboard-data.test.ts
```

Expected: FAIL because module/function does not exist.

**Step 3: Implement minimal reader**

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

export type DashboardData = {
  root: string;
  today: string;
  journalToday: string;
  tasks: {
    inbox: string[];
    next: string[];
  };
  recentHabits: Array<Record<string, unknown>>;
};

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export async function buildDashboardData(root: string, today: string): Promise<DashboardData> {
  const [journalToday, inbox, next, habitsText] = await Promise.all([
    readText(path.join(root, "journal", `${today}.md`)),
    readText(path.join(root, "tasks/inbox.todo")),
    readText(path.join(root, "tasks/next.todo")),
    readText(path.join(root, "habits/log.jsonl")),
  ]);

  const recentHabits = lines(habitsText)
    .slice(-20)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return { raw: line };
      }
    });

  return {
    root,
    today,
    journalToday,
    tasks: { inbox: lines(inbox), next: lines(next) },
    recentHabits,
  };
}
```

**Step 4: Run tests**

```bash
nix develop .#default --command bun test packages/life-os/test/dashboard-data.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/life-os/src/dashboard-data.ts packages/life-os/test/dashboard-data.test.ts
git commit -m "feat(life-os): add dashboard summary model"
```

---

### Task 3: Add a minimal Bun dashboard HTTP server

**Objective:** Serve read-only HTML and health endpoints.

**Files:**
- Create: `packages/life-os/src/dashboard.ts`
- Modify: `flake.nix` package/install section if needed

**Step 1: Implement server**

```ts
import { buildDashboardData } from "./dashboard-data";

const root = process.env.LIFE_ROOT || "/srv/life";
const host = process.env.LIFE_DASHBOARD_HOST || "127.0.0.1";
const port = Number(process.env.LIFE_DASHBOARD_PORT || "9120");

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] || char));
}

function page(data: Awaited<ReturnType<typeof buildDashboardData>>): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Life OS</title></head>
<body>
  <h1>Life OS — ${escapeHtml(data.today)}</h1>
  <h2>Next</h2><ul>${data.tasks.next.map((task) => `<li>${escapeHtml(task)}</li>`).join("")}</ul>
  <h2>Inbox</h2><ul>${data.tasks.inbox.map((task) => `<li>${escapeHtml(task)}</li>`).join("")}</ul>
  <h2>Journal</h2><pre>${escapeHtml(data.journalToday)}</pre>
  <h2>Recent habits</h2><pre>${escapeHtml(JSON.stringify(data.recentHabits, null, 2))}</pre>
</body></html>`;
}

Bun.serve({
  hostname: host,
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, root });
    }
    if (url.pathname !== "/") return new Response("not found", { status: 404 });
    const today = new Date().toISOString().slice(0, 10);
    const data = await buildDashboardData(root, today);
    return new Response(page(data), { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});

console.log(`Life OS dashboard listening on http://${host}:${port}`);
```

**Step 2: Run locally**

```bash
tmp=$(mktemp -d)
nix run .#life -- --root "$tmp" check
LIFE_ROOT="$tmp" LIFE_DASHBOARD_PORT=9120 nix develop .#default --command bun packages/life-os/src/dashboard.ts
```

In another shell:

```bash
curl -fsS http://127.0.0.1:9120/healthz
curl -fsS http://127.0.0.1:9120/ | grep 'Life OS'
```

Expected: health JSON and HTML page.

**Step 3: Commit**

```bash
git add packages/life-os/src/dashboard.ts flake.nix
git commit -m "feat(life-os): add minimal web dashboard"
```

---

### Task 4: Add dashboard write actions with tests

**Objective:** Add simple POST endpoints for the same mutations supported by the CLI.

**Files:**
- Modify: `packages/life-os/src/dashboard.ts`
- Modify: `packages/life-os/test/dashboard-data.test.ts` or add `dashboard.test.ts`

**Step 1: Add endpoints**

Support form-encoded POST requests:

- `POST /journal` with `text`
- `POST /tasks/inbox` with `text`
- `POST /habits/log` with `habit` and optional `note`

Each endpoint should call exported CLI/core functions, then redirect to `/` with `303 See Other`.

**Step 2: Add tests where cheap**

Keep tests mostly around pure functions. If server endpoint tests become awkward in Bun, use a smoke test script instead of overbuilding a test harness.

**Step 3: Verify manually against temp root**

```bash
curl -i -X POST -d 'text=test entry' http://127.0.0.1:9120/journal
curl -i -X POST -d 'text=test task' http://127.0.0.1:9120/tasks/inbox
curl -i -X POST -d 'habit=walk&note=20min' http://127.0.0.1:9120/habits/log
```

Expected: HTTP 303 redirects and files updated in temp root.

**Step 4: Commit**

```bash
git add packages/life-os/src/dashboard.ts packages/life-os/test/
git commit -m "feat(life-os): add dashboard capture actions"
```

---

### Task 5: Package the dashboard binary in Nix

**Objective:** Install a `life-dashboard` executable alongside the existing `life` CLI.

**Files:**
- Modify: `flake.nix`

**Step 1: Inspect current package derivation**

Find where the `life` executable is created. Extend it with another wrapper:

```bash
search_files "life-os" path=/home/alex/repos/nazar/flake.nix
```

**Step 2: Add executable wrapper**

Expected shape, adapted to existing derivation:

```bash
makeWrapper ${pkgs.bun}/bin/bun $out/bin/life-dashboard \
  --add-flags "$out/share/life-os/dashboard.ts"
```

Or compile/use Bun's supported packaging approach if already used by the package.

**Step 3: Verify package**

```bash
nix build .#life-os --print-build-logs
./result/bin/life --help
LIFE_ROOT=$(mktemp -d) LIFE_DASHBOARD_PORT=9120 ./result/bin/life-dashboard
```

Expected: CLI and dashboard start.

**Step 4: Commit**

```bash
git add flake.nix
git commit -m "build(life-os): package dashboard executable"
```

---

### Task 6: Add declarative NixOS service for Nazar

**Objective:** Run the dashboard on Nazar as a private service.

**Files:**
- Create: `nix/modules/host/life-os-dashboard.nix`
- Modify: `nix/hosts/nazar/default.nix`
- Modify: `flake.nix` checks
- Modify: `runbooks/LIFE_OS_CLIENTS.md` or `runbooks/LIFE_OS.md`

**Step 1: Add module**

```nix
{ config, lib, pkgs, self, ... }:
let
  port = 9120;
in
{
  systemd.services.life-os-dashboard = {
    description = "Life OS private web dashboard";
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" "tailscaled.service" ];
    wants = [ "network-online.target" "tailscaled.service" ];
    environment = {
      LIFE_ROOT = "/srv/life";
      LIFE_DASHBOARD_HOST = "0.0.0.0";
      LIFE_DASHBOARD_PORT = toString port;
    };
    serviceConfig = {
      Type = "simple";
      ExecStart = "${config.environment.systemPackages or pkgs.life-os}/bin/life-dashboard";
      Restart = "always";
      RestartSec = "5s";
      DynamicUser = false;
      User = "alex";
      Group = "users";
      WorkingDirectory = "/srv/life";
      ReadWritePaths = [ "/srv/life" ];
      NoNewPrivileges = true;
      PrivateTmp = true;
    };
  };

  networking.firewall.interfaces.tailscale0.allowedTCPPorts = [ port ];
}
```

Adjust package reference to match the repo's flake/module pattern.

**Step 2: Import module**

Add to `nix/hosts/nazar/default.nix` imports:

```nix
../../modules/host/life-os-dashboard.nix
```

**Step 3: Add flake evaluation assertions**

Assert:

- service enabled,
- wanted by `multi-user.target`,
- port allowed only on `tailscale0`,
- global firewall does not allow the dashboard port.

**Step 4: Verify**

```bash
nix fmt
git diff --check
nix flake check --no-build
nix build .#nixosConfigurations.nazar.config.system.build.toplevel --print-build-logs
```

**Step 5: Switch and smoke-test**

```bash
sudo nixos-rebuild switch --flake .#nazar
systemctl is-active life-os-dashboard
curl -fsS http://127.0.0.1:9120/healthz
curl -fsS http://nazar.ojos-sargas.ts.net:9120/ | grep 'Life OS'
```

**Step 6: Commit**

```bash
git add nix/modules/host/life-os-dashboard.nix nix/hosts/nazar/default.nix flake.nix runbooks/
git commit -m "feat(life-os): deploy private web dashboard"
```

---

### Task 7: Polish the UI without changing architecture

**Objective:** Make the dashboard pleasant but still boring and maintainable.

**Files:**
- Modify: `packages/life-os/src/dashboard.ts`
- Optional create: `packages/life-os/src/dashboard-style.ts`

**Step 1: Add simple CSS**

Use inline CSS or a single `/style.css` route. Avoid a frontend build pipeline for v1.

**Step 2: Add sections**

Layout:

- top row: date, health, quick capture,
- left: Next + Inbox tasks,
- middle: today's journal,
- right: habit log and upcoming calendar/reminders.

**Step 3: Verify**

```bash
nix develop .#default --command bun test
nix build .#life-os --print-build-logs
```

**Step 4: Commit**

```bash
git add packages/life-os/src/dashboard.ts
git commit -m "feat(life-os): polish dashboard layout"
```

---

## Final verification checklist

Run from `/home/alex/repos/nazar`:

```bash
nix fmt
git diff --check
nix flake check --no-build
nix build .#checks.x86_64-linux.life-os-tests --print-build-logs
nix build .#nixosConfigurations.nazar.config.system.build.toplevel --print-build-logs
sudo nixos-rebuild switch --flake .#nazar
systemctl is-active life-os-dashboard
curl -fsS http://127.0.0.1:9120/healthz
curl -fsS http://nazar.ojos-sargas.ts.net:9120/ | grep 'Life OS'
```

## Open design questions before implementation

- Should the dashboard be write-capable immediately, or should v1 remain read-only for one iteration?
- Should it bind directly to `tailscale0`/`0.0.0.0`, or stay localhost-only behind an Nginx Tailscale-only vhost?
- Should Radicale items be read from exported/synced `.ics` files, directly from Radicale, or initially omitted from the dashboard?
- Should dashboard writes call the TypeScript functions directly or shell out to `/run/current-system/sw/bin/life` for maximum behavioral parity?
