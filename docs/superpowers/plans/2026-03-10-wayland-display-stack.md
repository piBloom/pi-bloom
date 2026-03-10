# Wayland Display Stack Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Xvfb with Sway + wayvnc + noVNC for a Wayland-native display stack with browser-based remote desktop and HDMI output.

**Architecture:** Sway compositor (headless or GPU) → wayvnc (VNC server) → websockify + noVNC (browser access). The bloom-display extension rewires all 10 actions from X11 tools (xdotool, scrot) to Wayland equivalents (wlrctl, grim, swaymsg). A detect-display.sh script auto-selects headless vs GPU mode at boot.

**Tech Stack:** Sway, wayvnc, noVNC, websockify, wlrctl, grim, wl-clipboard, foot, AT-SPI2

**Spec:** `docs/superpowers/specs/2026-03-10-wayland-display-stack-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `os/sysconfig/sway-config` | Sway compositor configuration (resolution, layout, no bar) |
| `os/sysconfig/bloom-sway.service` | Systemd unit: runs Sway with auto-detected backend |
| `os/sysconfig/bloom-wayvnc.service` | Systemd unit: VNC server on Sway, localhost:5900 |
| `os/sysconfig/bloom-novnc.service` | Systemd unit: websockify proxy, 0.0.0.0:6080 |
| `os/sysconfig/bloom-display.target` | Systemd target grouping all display services |
| `os/sysconfig/bloom-novnc.xml` | Firewalld service definition for port 6080 |
| `os/scripts/detect-display.sh` | Headless vs GPU detection, writes /run/bloom/display-env |

### Modified files

| File | What changes |
|------|-------------|
| `os/Containerfile` | Swap X11 packages → Wayland packages, COPY new service files, enable new target |
| `os/sysconfig/bloom-bashrc` | Replace `DISPLAY=:99` with `WAYLAND_DISPLAY` + `SWAYSOCK` sourcing |
| `extensions/bloom-display/actions.ts` | Rewrite all 10 handlers: scrot→grim, xdotool→wlrctl/swaymsg |
| `extensions/bloom-display/index.ts` | Update JSDoc `@see` link to new spec |
| `tests/extensions/bloom-display.test.ts` | Unchanged structurally (registration tests), but verify still passes |
| `README.md` | Update Desktop line |
| `AGENTS.md` | Update bloom-display tool description |
| `docs/quick_deploy.md` | Update display section |

### Removed files

| File | Reason |
|------|--------|
| `os/sysconfig/bloom-display.service` | Replaced by bloom-sway.service + bloom-display.target |

---

## Chunk 1: OS Infrastructure

### Task 1: Create detect-display.sh

**Files:**
- Create: `os/scripts/detect-display.sh`

- [ ] **Step 1: Write detect-display.sh**

```bash
#!/bin/bash
# detect-display.sh — Auto-detect GPU or headless mode for Sway.
# Writes environment variables to /run/bloom/display-env.
# Called as ExecStartPre from bloom-sway.service.

set -euo pipefail

ENV_FILE="/run/bloom/display-env"
mkdir -p "$(dirname "$ENV_FILE")"

if [ -d /dev/dri ] && ls /dev/dri/renderD* >/dev/null 2>&1; then
    # Real GPU available — use DRM backend
    echo "# GPU detected — using DRM backend" > "$ENV_FILE"
    echo "WLR_BACKENDS=drm" >> "$ENV_FILE"
else
    # No GPU — headless virtual framebuffer
    echo "# No GPU — using headless backend" > "$ENV_FILE"
    echo "WLR_BACKENDS=headless" >> "$ENV_FILE"
    echo "WLR_LIBINPUT_NO_DEVICES=1" >> "$ENV_FILE"
fi
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x os/scripts/detect-display.sh`

- [ ] **Step 3: Commit**

```bash
git add os/scripts/detect-display.sh
git commit -m "feat(display): add detect-display.sh for headless/GPU auto-detection"
```

---

### Task 2: Create Sway config

**Files:**
- Create: `os/sysconfig/sway-config`

- [ ] **Step 1: Write sway-config**

```
# Bloom Sway config — minimal tiling WM for AI computer use + remote desktop.
# Headless or HDMI, no desktop chrome.

# Output: 1280x1024 default (matches prior Xvfb resolution)
output * {
    mode 1280x1024@60Hz
    bg #1a1a2e solid_color
}

# No status bar — Pi doesn't need desktop chrome
bar {
    mode invisible
}

# Default layout: tabbed (Pi sees one app at a time, swaymsg switches)
workspace_layout tabbed

# Auto-float dialogs, tile everything else
for_window [window_role="dialog"] floating enable
for_window [window_type="dialog"] floating enable

# No idle / screen lock
seat seat0 idle_timeout 0

# Default terminal
set $term foot
```

- [ ] **Step 2: Commit**

```bash
git add os/sysconfig/sway-config
git commit -m "feat(display): add Sway compositor config"
```

---

### Task 3: Create systemd services

**Files:**
- Create: `os/sysconfig/bloom-sway.service`
- Create: `os/sysconfig/bloom-wayvnc.service`
- Create: `os/sysconfig/bloom-novnc.service`
- Create: `os/sysconfig/bloom-display.target`

- [ ] **Step 1: Write bloom-sway.service**

```ini
[Unit]
Description=Bloom Display (Sway Wayland compositor)
After=network.target

[Service]
Type=simple
User=pi
RuntimeDirectory=bloom
ExecStartPre=/usr/local/share/bloom/os/scripts/detect-display.sh
EnvironmentFile=-/run/bloom/display-env
Environment=XDG_RUNTIME_DIR=/run/user/%U
ExecStart=/usr/bin/sway --config /etc/bloom/sway-config
Restart=on-failure
RestartSec=5

[Install]
WantedBy=bloom-display.target
```

- [ ] **Step 2: Write bloom-wayvnc.service**

```ini
[Unit]
Description=Bloom VNC Server (wayvnc)
After=bloom-sway.service
BindsTo=bloom-sway.service

[Service]
Type=simple
User=pi
Environment=WAYLAND_DISPLAY=wayland-1
Environment=XDG_RUNTIME_DIR=/run/user/%U
ExecStart=/usr/bin/wayvnc --output=* 127.0.0.1 5900
Restart=on-failure
RestartSec=3

[Install]
WantedBy=bloom-display.target
```

- [ ] **Step 3: Write bloom-novnc.service**

```ini
[Unit]
Description=Bloom Web Desktop (noVNC)
After=bloom-wayvnc.service

[Service]
Type=simple
User=pi
ExecStart=/usr/bin/websockify --web=/usr/share/novnc 6080 127.0.0.1:5900
Restart=on-failure
RestartSec=3

[Install]
WantedBy=bloom-display.target
```

- [ ] **Step 4: Write bloom-display.target**

```ini
[Unit]
Description=Bloom Display Stack (Sway + VNC + noVNC)
Wants=bloom-sway.service bloom-wayvnc.service bloom-novnc.service

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 5: Commit**

```bash
git add os/sysconfig/bloom-sway.service os/sysconfig/bloom-wayvnc.service os/sysconfig/bloom-novnc.service os/sysconfig/bloom-display.target
git commit -m "feat(display): add systemd services for Sway, wayvnc, noVNC"
```

---

### Task 4: Create firewalld service

**Files:**
- Create: `os/sysconfig/bloom-novnc.xml`

- [ ] **Step 1: Write bloom-novnc.xml**

```xml
<?xml version="1.0" encoding="utf-8"?>
<service>
  <short>Bloom Web Desktop</short>
  <description>noVNC browser-based remote desktop for Bloom OS (port 6080)</description>
  <port protocol="tcp" port="6080"/>
</service>
```

- [ ] **Step 2: Commit**

```bash
git add os/sysconfig/bloom-novnc.xml
git commit -m "feat(display): add firewalld service for noVNC port 6080"
```

---

### Task 5: Update Containerfile

**Files:**
- Modify: `os/Containerfile:7-43` (package install)
- Modify: `os/Containerfile:98-100` (display service section)

- [ ] **Step 1: Swap packages in the dnf install block**

In `os/Containerfile`, replace the three X11 packages with Wayland equivalents:

```diff
-    chromium \
-    xorg-x11-server-Xvfb \
-    xdotool \
-    scrot \
+    chromium \
+    sway \
+    wayvnc \
+    novnc \
+    python3-websockify \
+    wlrctl \
+    grim \
+    slurp \
+    wl-clipboard \
+    foot \
```

- [ ] **Step 2: Replace display service section**

Replace lines 98-100 (the Xvfb display block):

```dockerfile
# Display stack: Sway Wayland compositor + wayvnc + noVNC for AI computer use + remote desktop
COPY os/sysconfig/sway-config /etc/bloom/sway-config
COPY os/scripts/detect-display.sh /usr/local/share/bloom/os/scripts/detect-display.sh
RUN chmod +x /usr/local/share/bloom/os/scripts/detect-display.sh
COPY os/sysconfig/bloom-sway.service /usr/lib/systemd/system/bloom-sway.service
COPY os/sysconfig/bloom-wayvnc.service /usr/lib/systemd/system/bloom-wayvnc.service
COPY os/sysconfig/bloom-novnc.service /usr/lib/systemd/system/bloom-novnc.service
COPY os/sysconfig/bloom-display.target /usr/lib/systemd/system/bloom-display.target
COPY os/sysconfig/bloom-novnc.xml /etc/firewalld/services/bloom-novnc.xml
RUN systemctl enable bloom-display.target
```

- [ ] **Step 3: Remove old bloom-display.service file**

Run: `rm os/sysconfig/bloom-display.service`

- [ ] **Step 4: Commit**

```bash
git add os/Containerfile os/sysconfig/bloom-novnc.xml
git rm os/sysconfig/bloom-display.service
git commit -m "feat(display): swap Xvfb for Sway/wayvnc/noVNC in Containerfile"
```

---

### Task 6: Update bloom-bashrc

**Files:**
- Modify: `os/sysconfig/bloom-bashrc`

- [ ] **Step 1: Replace DISPLAY with Wayland env vars**

Replace the full contents of `os/sysconfig/bloom-bashrc` with:

```bash
export BLOOM_DIR="$HOME/Bloom"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export WAYLAND_DISPLAY="wayland-1"
_sway_sock="$(ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock 2>/dev/null | head -1)"
if [ -S "$_sway_sock" ]; then
    export SWAYSOCK="$_sway_sock"
fi
unset _sway_sock
export BROWSER="chromium --ozone-platform=wayland"
export PATH="/usr/local/share/bloom/node_modules/.bin:$PATH"
```

- [ ] **Step 2: Update bloom-bash_profile comment**

In `os/sysconfig/bloom-bash_profile` line 1, change:

```diff
-# Source .bashrc for env vars (BLOOM_DIR, DISPLAY, PATH, etc.)
+# Source .bashrc for env vars (BLOOM_DIR, WAYLAND_DISPLAY, PATH, etc.)
```

- [ ] **Step 3: Commit**

```bash
git add os/sysconfig/bloom-bashrc os/sysconfig/bloom-bash_profile
git commit -m "feat(display): switch shell env from DISPLAY to WAYLAND_DISPLAY/SWAYSOCK"
```

---

## Chunk 2: Extension Rewrite

### Task 7: Rewrite bloom-display actions.ts

**Files:**
- Modify: `extensions/bloom-display/actions.ts` (full rewrite)

This is the core migration. Every handler changes from X11 tools to Wayland equivalents.

**Important:** `wlrctl pointer move X Y` is used for absolute pointer positioning. Verify the Fedora 42 `wlrctl` package supports this (check `wlrctl --version` and `wlrctl pointer move --help` in the VM). If it only supports relative movement, fall back to `ydotool` for pointer positioning or use Sway IPC seat cursor warping.

- [ ] **Step 1: Rewrite the full actions.ts file**

Replace the entire contents of `extensions/bloom-display/actions.ts` with:

```typescript
/**
 * Handler / business logic for bloom-display (Wayland / Sway).
 *
 * @see {@link ../../docs/superpowers/specs/2026-03-10-wayland-display-stack-design.md} Design spec
 */
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../../lib/exec.js";
import { errorResult, truncate } from "../../lib/shared.js";

/** Wayland env vars needed by all display commands. */
const WAYLAND_ENV: Record<string, string> = {
	WAYLAND_DISPLAY: "wayland-1",
	XDG_RUNTIME_DIR: `/run/user/${process.getuid?.() ?? 1000}`,
};

/** Resolve SWAYSOCK from the runtime dir (Sway names it dynamically). */
function swaysock(): string {
	const dir = WAYLAND_ENV.XDG_RUNTIME_DIR;
	try {
		const match = readdirSync(dir).find((f: string) => f.startsWith("sway-ipc.") && f.endsWith(".sock"));
		return match ? join(dir, match) : "";
	} catch {
		return "";
	}
}

/** Run a command with Wayland env vars. */
async function runDisplay(cmd: string, args: string[], signal?: AbortSignal): ReturnType<typeof run> {
	const sock = swaysock();
	const env: Record<string, string> = { ...WAYLAND_ENV };
	if (sock) env.SWAYSOCK = sock;
	return run(cmd, args, signal, undefined, env);
}

/** Take a screenshot, optionally of a region. */
export async function handleScreenshot(
	params: { region?: { x: number; y: number; w: number; h: number } },
	signal?: AbortSignal,
) {
	const outPath = "/tmp/bloom-screenshot.png";
	const args: string[] = [];
	if (params.region) {
		const { x, y, w, h } = params.region;
		args.push("-g", `${x},${y} ${w}x${h}`);
	}
	args.push(outPath);
	const result = await runDisplay("grim", args, signal);
	if (result.exitCode !== 0) {
		return errorResult(`Screenshot failed:\n${result.stderr}`);
	}
	const buf = await readFile(outPath);
	const base64 = buf.toString("base64");
	return {
		content: [{ type: "image" as const, data: base64, mimeType: "image/png" }],
		details: { path: outPath },
	};
}

/** Click at coordinates. */
export async function handleClick(params: { x?: number; y?: number; button?: number }, signal?: AbortSignal) {
	if (params.x === undefined || params.y === undefined) {
		return errorResult("click requires x and y coordinates.");
	}
	// Move pointer to absolute position, then click
	const moveResult = await runDisplay("wlrctl", ["pointer", "move", String(params.x), String(params.y)], signal);
	if (moveResult.exitCode !== 0) {
		return errorResult(`Pointer move failed:\n${moveResult.stderr}`);
	}
	const btn = params.button === 3 ? "right" : params.button === 2 ? "middle" : "left";
	const clickResult = await runDisplay("wlrctl", ["pointer", "click", btn], signal);
	if (clickResult.exitCode !== 0) {
		return errorResult(`Click failed:\n${clickResult.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Clicked (${params.x}, ${params.y}) button ${btn}.` }],
		details: { x: params.x, y: params.y, button: btn },
	};
}

/** Type text. */
export async function handleType(params: { text?: string }, signal?: AbortSignal) {
	if (!params.text) {
		return errorResult("type requires text parameter.");
	}
	const result = await runDisplay("wlrctl", ["keyboard", "type", params.text], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Type failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Typed ${params.text.length} characters.` }],
		details: { length: params.text.length },
	};
}

/** Send key combo. */
export async function handleKey(params: { keys?: string }, signal?: AbortSignal) {
	if (!params.keys) {
		return errorResult("key requires keys parameter (e.g. 'ctrl+l', 'Return').");
	}
	const result = await runDisplay("wlrctl", ["keyboard", "key", params.keys], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Key press failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Sent key: ${params.keys}` }],
		details: { keys: params.keys },
	};
}

/** Move mouse. */
export async function handleMove(params: { x?: number; y?: number }, signal?: AbortSignal) {
	if (params.x === undefined || params.y === undefined) {
		return errorResult("move requires x and y coordinates.");
	}
	const result = await runDisplay("wlrctl", ["pointer", "move", String(params.x), String(params.y)], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Mouse move failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Moved mouse to (${params.x}, ${params.y}).` }],
		details: { x: params.x, y: params.y },
	};
}

/** Scroll at position. */
export async function handleScroll(
	params: { x?: number; y?: number; direction?: "up" | "down"; clicks?: number },
	signal?: AbortSignal,
) {
	if (params.x === undefined || params.y === undefined) {
		return errorResult("scroll requires x and y coordinates.");
	}
	if (!params.direction) {
		return errorResult("scroll requires direction ('up' or 'down').");
	}
	// Move to position first
	const moveResult = await runDisplay("wlrctl", ["pointer", "move", String(params.x), String(params.y)], signal);
	if (moveResult.exitCode !== 0) {
		return errorResult(`Pointer move failed:\n${moveResult.stderr}`);
	}
	// Scroll: negative = up, positive = down
	const n = params.clicks ?? 3;
	const amount = params.direction === "up" ? String(-n) : String(n);
	const scrollResult = await runDisplay("wlrctl", ["pointer", "scroll", amount], signal);
	if (scrollResult.exitCode !== 0) {
		return errorResult(`Scroll failed:\n${scrollResult.stderr}`);
	}
	return {
		content: [
			{
				type: "text" as const,
				text: `Scrolled ${params.direction} ${n} clicks at (${params.x}, ${params.y}).`,
			},
		],
		details: { x: params.x, y: params.y, direction: params.direction, clicks: n },
	};
}

/** Read the AT-SPI2 accessibility tree. */
export async function handleUiTree(params: { app?: string }, signal?: AbortSignal) {
	const scriptPath = join("/usr/local/share/bloom/os/scripts", "ui-tree.py");
	const treeArgs = [scriptPath];
	if (params.app) {
		treeArgs.push("--app", params.app);
	}
	// AT-SPI2 uses D-Bus on Wayland — pass WAYLAND_DISPLAY for apps that need it
	const result = await runDisplay("python3", treeArgs, signal);
	if (result.exitCode !== 0) {
		return errorResult(`AT-SPI2 tree failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: truncate(result.stdout || "[]") }],
		details: { app: params.app ?? null },
	};
}

/** Window info from Sway's tree. */
interface SwayNode {
	id: number;
	name: string | null;
	focused: boolean;
	type: string;
	nodes?: SwayNode[];
	floating_nodes?: SwayNode[];
}

/** Recursively collect visible windows from the Sway tree. */
function collectWindows(node: SwayNode): Array<{ id: string; name: string; focused: boolean }> {
	const results: Array<{ id: string; name: string; focused: boolean }> = [];
	if (node.type === "con" && node.name) {
		results.push({ id: String(node.id), name: node.name, focused: node.focused });
	}
	for (const child of node.nodes ?? []) {
		results.push(...collectWindows(child));
	}
	for (const child of node.floating_nodes ?? []) {
		results.push(...collectWindows(child));
	}
	return results;
}

/** List windows via swaymsg. */
export async function handleWindows(signal?: AbortSignal) {
	const result = await runDisplay("swaymsg", ["-t", "get_tree"], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Window list failed:\n${result.stderr}`);
	}
	try {
		const tree: SwayNode = JSON.parse(result.stdout);
		const windows = collectWindows(tree);
		return {
			content: [{ type: "text" as const, text: JSON.stringify(windows, null, 2) }],
			details: { count: windows.length },
		};
	} catch (e) {
		return errorResult(`Failed to parse Sway tree: ${e}`);
	}
}

/** Launch an app. */
export async function handleLaunch(params: { command?: string }, signal?: AbortSignal) {
	if (!params.command) {
		return errorResult("launch requires command parameter.");
	}
	const result = await runDisplay("bash", ["-c", `${params.command} &`], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Launch failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Launched: ${params.command}` }],
		details: { command: params.command },
	};
}

/** Focus a window by title or Sway container ID. */
export async function handleFocus(params: { target?: string }, signal?: AbortSignal) {
	if (!params.target) {
		return errorResult("focus requires target parameter (window title or ID).");
	}
	const isNumeric = /^\d+$/.test(params.target);
	const criteria = isNumeric ? `[con_id=${params.target}]` : `[title="${params.target}"]`;
	const result = await runDisplay("swaymsg", [`${criteria} focus`], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Focus failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Focused window: ${params.target}` }],
		details: { target: params.target },
	};
}
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: no errors

- [ ] **Step 3: Update index.ts JSDoc**

In `extensions/bloom-display/index.ts`, line 5, change:

```diff
- * @see {@link ../../docs/plans/2026-03-08-drop-xpra-headless-display.md} Design doc
+ * @see {@link ../../docs/superpowers/specs/2026-03-10-wayland-display-stack-design.md} Design spec
```

- [ ] **Step 4: Run existing tests**

Run: `npm run test -- tests/extensions/bloom-display.test.ts`
Expected: all 4 tests pass (registration + structure tests don't depend on runtime tools)

- [ ] **Step 5: Commit**

```bash
git add extensions/bloom-display/actions.ts extensions/bloom-display/index.ts
git commit -m "feat(display): rewrite bloom-display actions for Wayland (wlrctl, grim, swaymsg)"
```

---

## Chunk 3: Documentation

### Task 8: Update documentation references

**Files:**
- Modify: `README.md:182`
- Modify: `AGENTS.md:166`
- Modify: `docs/quick_deploy.md:119`

- [ ] **Step 1: Update README.md**

At line 182, change:

```diff
-- **Desktop**: Xvfb (headless X11 framebuffer for AI computer use), tmux
+- **Desktop**: Sway (Wayland compositor), wayvnc + noVNC (browser remote desktop), tmux
```

- [ ] **Step 2: Update AGENTS.md**

At line 166, change:

```diff
-AI agent computer use: screenshots, input injection, accessibility tree, and window management on the headless Xvfb display.
+AI agent computer use: screenshots, input injection, accessibility tree, and window management on the Sway Wayland compositor. Browser remote desktop via noVNC on port 6080.
```

- [ ] **Step 3: Update docs/quick_deploy.md**

At line 119, change:

```diff
-Pi runs in the terminal. The headless Xvfb display (:99) is available for AI computer use
+Pi runs in the terminal. The Sway Wayland display is available for AI computer use
-(screenshots, browser automation, GUI apps) — no remote viewer is needed.
+(screenshots, browser automation, GUI apps). Open http://<bloom-ip>:6080 for browser-based remote desktop.
```

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md docs/quick_deploy.md
git commit -m "docs: update display stack references to Sway/wayvnc/noVNC"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: all tests pass

- [ ] **Step 2: Run lint/format check**

Run: `npm run check`
Expected: no errors

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: clean build

- [ ] **Step 4: Verify no stale X11 references remain in active code**

Run: `grep -rn "xdotool\|scrot\|Xvfb\|DISPLAY.*:99" extensions/ lib/ os/sysconfig/ os/scripts/ os/Containerfile --include="*.ts" --include="*.sh" --include="*.service" --include="*.conf" --include="Containerfile"`
Expected: no matches (old plan docs in docs/ are fine — they're historical)

**Note:** For runtime verification (boot VM, test noVNC, etc.), see the spec's "Verification" section in `docs/superpowers/specs/2026-03-10-wayland-display-stack-design.md`. Those steps require a built image and running VM — run them post-merge with `just build && just qcow2 && just vm`.

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "chore: final cleanup for Wayland display migration"
```
