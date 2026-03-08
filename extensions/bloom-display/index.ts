/**
 * bloom-display -- AI agent computer use: screenshots, input injection, accessibility tree, window management.
 *
 * @tools display
 * @see {@link ../../docs/plans/2026-03-08-xvfb-xpra-display-stack-design.md} Design doc
 */
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	handleClick,
	handleFocus,
	handleKey,
	handleLaunch,
	handleMove,
	handleScreenshot,
	handleScroll,
	handleType,
	handleUiTree,
	handleWindows,
	handleWorkspace,
} from "./actions.js";

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
			switch (params.action) {
				case "screenshot":
					return handleScreenshot(params, signal);
				case "click":
					return handleClick(params, signal);
				case "type":
					return handleType(params, signal);
				case "key":
					return handleKey(params, signal);
				case "move":
					return handleMove(params, signal);
				case "scroll":
					return handleScroll(params, signal);
				case "ui_tree":
					return handleUiTree(params, signal);
				case "windows":
					return handleWindows(signal);
				case "workspace":
					return handleWorkspace(params, signal);
				case "launch":
					return handleLaunch(params, signal);
				case "focus":
					return handleFocus(params, signal);
			}
		},
	});
}
