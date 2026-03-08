/**
 * bloom-display -- AI agent computer use: screenshots, input injection, accessibility tree, window management.
 *
 * @tools display
 * @see {@link ../docs/plans/2026-03-08-xvfb-xpra-display-stack-design.md} Design doc
 */
import { join } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { run } from "../lib/exec.js";
import { errorResult, truncate } from "../lib/shared.js";

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

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "display",
		label: "Display Control",
		description:
			"AI computer use: take screenshots, inject mouse/keyboard input, read the accessibility tree, and manage windows. " +
			"Actions: screenshot, click, type, key, move, scroll, ui_tree, windows, workspace, launch, focus.",
		parameters: Type.Object({
			action: StringEnum(
				[
					"screenshot",
					"click",
					"type",
					"key",
					"move",
					"scroll",
					"ui_tree",
					"windows",
					"workspace",
					"launch",
					"focus",
				] as const,
				{
					description:
						"screenshot: capture screen. click: click at coordinates. type: type text. key: send key combo. " +
						"move: move mouse. scroll: scroll at position. ui_tree: AT-SPI2 accessibility tree. " +
						"windows: list windows via i3. workspace: switch workspace. launch: start an app. focus: focus a window.",
				},
			),
			x: Type.Optional(Type.Number({ description: "X coordinate (click, move, scroll)" })),
			y: Type.Optional(Type.Number({ description: "Y coordinate (click, move, scroll)" })),
			text: Type.Optional(Type.String({ description: "Text to type (type action)" })),
			keys: Type.Optional(Type.String({ description: "Key combo e.g. 'ctrl+l', 'Return' (key action)" })),
			button: Type.Optional(Type.Number({ description: "Mouse button 1=left 2=middle 3=right (click, default 1)" })),
			direction: Type.Optional(
				StringEnum(["up", "down"] as const, { description: "Scroll direction (scroll action)" }),
			),
			clicks: Type.Optional(Type.Number({ description: "Number of scroll clicks (scroll, default 3)" })),
			command: Type.Optional(Type.String({ description: "Command to launch (launch action)" })),
			number: Type.Optional(Type.Number({ description: "Workspace number (workspace action)" })),
			target: Type.Optional(Type.String({ description: "Window title or ID to focus (focus action)" })),
			app: Type.Optional(Type.String({ description: "Filter by app name (ui_tree action)" })),
			region: Type.Optional(
				Type.Object(
					{
						x: Type.Number(),
						y: Type.Number(),
						w: Type.Number(),
						h: Type.Number(),
					},
					{ description: "Capture region (screenshot action)" },
				),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const { action } = params;

			switch (action) {
				case "screenshot": {
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

				case "click": {
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

				case "type": {
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

				case "key": {
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

				case "move": {
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

				case "scroll": {
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

				case "ui_tree": {
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

				case "windows": {
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

				case "workspace": {
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

				case "launch": {
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

				case "focus": {
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
			}
		},
	});
}
