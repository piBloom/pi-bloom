/**
 * Handler / business logic for bloom-display.
 */
import { join } from "node:path";
import { run } from "../../lib/exec.js";
import { errorResult, truncate } from "../../lib/shared.js";

const DISPLAY = ":99";

/** Run a command with DISPLAY=:99 set. */
async function runDisplay(cmd: string, args: string[], signal?: AbortSignal): ReturnType<typeof run> {
	const prevDisplay = process.env.DISPLAY;
	process.env.DISPLAY = DISPLAY;
	try {
		return await run(cmd, args, signal);
	} finally {
		if (prevDisplay !== undefined) {
			process.env.DISPLAY = prevDisplay;
		} else {
			delete process.env.DISPLAY;
		}
	}
}

/** Take a screenshot, optionally of a region. */
export async function handleScreenshot(
	params: { region?: { x: number; y: number; w: number; h: number } },
	signal?: AbortSignal,
) {
	const args = ["--overwrite", "/tmp/bloom-screenshot.png"];
	if (params.region) {
		const { x, y, w, h } = params.region;
		args.unshift("--select", "--autoselect", `${x},${y},${w},${h}`);
	}
	const result = await runDisplay("scrot", args, signal);
	if (result.exitCode !== 0) {
		return errorResult(`Screenshot failed:\n${result.stderr}`);
	}
	const { readFile } = await import("node:fs/promises");
	const buf = await readFile("/tmp/bloom-screenshot.png");
	const base64 = buf.toString("base64");
	return {
		content: [{ type: "image" as const, data: base64, mimeType: "image/png" }],
		details: { path: "/tmp/bloom-screenshot.png" },
	};
}

/** Click at coordinates. */
export async function handleClick(
	params: { x?: number; y?: number; button?: number },
	signal?: AbortSignal,
) {
	if (params.x === undefined || params.y === undefined) {
		return errorResult("click requires x and y coordinates.");
	}
	const btn = String(params.button ?? 1);
	const result = await runDisplay(
		"xdotool",
		["mousemove", "--sync", String(params.x), String(params.y), "click", btn],
		signal,
	);
	if (result.exitCode !== 0) {
		return errorResult(`Click failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text", text: `Clicked (${params.x}, ${params.y}) button ${btn}.` }],
		details: { x: params.x, y: params.y, button: btn },
	};
}

/** Type text. */
export async function handleType(params: { text?: string }, signal?: AbortSignal) {
	if (!params.text) {
		return errorResult("type requires text parameter.");
	}
	const result = await runDisplay("xdotool", ["type", "--delay", "50", "--", params.text], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Type failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text", text: `Typed ${params.text.length} characters.` }],
		details: { length: params.text.length },
	};
}

/** Send key combo. */
export async function handleKey(params: { keys?: string }, signal?: AbortSignal) {
	if (!params.keys) {
		return errorResult("key requires keys parameter (e.g. 'ctrl+l', 'Return').");
	}
	const result = await runDisplay("xdotool", ["key", params.keys], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Key press failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text", text: `Sent key: ${params.keys}` }],
		details: { keys: params.keys },
	};
}

/** Move mouse. */
export async function handleMove(params: { x?: number; y?: number }, signal?: AbortSignal) {
	if (params.x === undefined || params.y === undefined) {
		return errorResult("move requires x and y coordinates.");
	}
	const result = await runDisplay(
		"xdotool",
		["mousemove", "--sync", String(params.x), String(params.y)],
		signal,
	);
	if (result.exitCode !== 0) {
		return errorResult(`Mouse move failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text", text: `Moved mouse to (${params.x}, ${params.y}).` }],
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
	const scrollBtn = params.direction === "up" ? "4" : "5";
	const n = params.clicks ?? 3;
	const scrollArgs = ["mousemove", "--sync", String(params.x), String(params.y)];
	for (let i = 0; i < n; i++) {
		scrollArgs.push("click", scrollBtn);
	}
	const result = await runDisplay("xdotool", scrollArgs, signal);
	if (result.exitCode !== 0) {
		return errorResult(`Scroll failed:\n${result.stderr}`);
	}
	return {
		content: [
			{
				type: "text",
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
	const result = await runDisplay("python3", treeArgs, signal);
	if (result.exitCode !== 0) {
		return errorResult(`AT-SPI2 tree failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text", text: truncate(result.stdout || "[]") }],
		details: { app: params.app ?? null },
	};
}

/** List windows via i3. */
export async function handleWindows(signal?: AbortSignal) {
	const result = await runDisplay("i3-msg", ["-t", "get_tree"], signal);
	if (result.exitCode !== 0) {
		return errorResult(`i3 get_tree failed:\n${result.stderr}`);
	}
	try {
		const tree = JSON.parse(result.stdout);
		const windows: Array<{
			id: number;
			name: string;
			focused: boolean;
			workspace: string;
			rect: unknown;
		}> = [];
		function walk(
			node: {
				id?: number;
				name?: string;
				focused?: boolean;
				type?: string;
				num?: number;
				nodes?: unknown[];
				floating_nodes?: unknown[];
				rect?: unknown;
			},
			wsName: string,
		) {
			const currentWs = node.type === "workspace" ? String(node.num ?? node.name ?? wsName) : wsName;
			if (node.type === "con" && node.name) {
				windows.push({
					id: node.id ?? 0,
					name: node.name ?? "",
					focused: node.focused ?? false,
					workspace: currentWs,
					rect: node.rect,
				});
			}
			for (const child of (node.nodes ?? []) as (typeof node)[]) {
				walk(child, currentWs);
			}
			for (const child of (node.floating_nodes ?? []) as (typeof node)[]) {
				walk(child, currentWs);
			}
		}
		walk(tree, "");
		return {
			content: [{ type: "text", text: JSON.stringify(windows, null, 2) }],
			details: { count: windows.length },
		};
	} catch {
		return {
			content: [{ type: "text", text: truncate(result.stdout) }],
			details: {},
		};
	}
}

/** Switch workspace. */
export async function handleWorkspace(params: { number?: number }, signal?: AbortSignal) {
	if (params.number === undefined) {
		return errorResult("workspace requires number parameter.");
	}
	const result = await runDisplay("i3-msg", ["workspace", String(params.number)], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Workspace switch failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text", text: `Switched to workspace ${params.number}.` }],
		details: { workspace: params.number },
	};
}

/** Launch an app. */
export async function handleLaunch(params: { command?: string }, signal?: AbortSignal) {
	if (!params.command) {
		return errorResult("launch requires command parameter.");
	}
	const result = await runDisplay("i3-msg", ["exec", "--no-startup-id", params.command], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Launch failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text", text: `Launched: ${params.command}` }],
		details: { command: params.command },
	};
}

/** Focus a window. */
export async function handleFocus(params: { target?: string }, signal?: AbortSignal) {
	if (!params.target) {
		return errorResult("focus requires target parameter (window title or ID).");
	}
	const isNumeric = /^\d+$/.test(params.target);
	const criteria = isNumeric ? `[con_id=${params.target}]` : `[title="${params.target}"]`;
	const result = await runDisplay("i3-msg", [`${criteria} focus`], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Focus failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text", text: `Focused window: ${params.target}` }],
		details: { target: params.target },
	};
}
