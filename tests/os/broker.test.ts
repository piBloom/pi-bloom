import { describe, expect, it } from "vitest";
import {
	type BrokerCommandResult,
	type BrokerConfig,
	type BrokerRuntime,
	brokerStatus,
	currentAutonomy,
	grantAdmin,
	handleRequest,
	PermissionError,
	parseDuration,
	revokeAdmin,
} from "../../core/os/broker.js";

interface RuntimeState {
	files: Map<string, string>;
	commands: string[][];
	now: number;
}

const baseConfig: BrokerConfig = {
	socketPath: "/run/nixpi-broker/broker.sock",
	elevationPath: "/var/lib/nixpi/broker/elevation.json",
	brokerStateDir: "/var/lib/nixpi/broker",
	primaryUser: "tester",
	defaultAutonomy: "maintain",
	elevationDuration: "30m",
	osUpdateEnable: true,
	allowedUnits: ["nixpi-ttyd.service", "nixpi-update.service"],
	defaultFlake: "/etc/nixos#nixos",
};

function createRuntime(
	commandHandler: (args: string[], state: RuntimeState) => Promise<BrokerCommandResult> | BrokerCommandResult,
	initial?: { files?: Map<string, string>; now?: number },
): { runtime: BrokerRuntime; state: RuntimeState } {
	const state: RuntimeState = {
		files: initial?.files ?? new Map(),
		commands: [],
		now: initial?.now ?? 1000,
	};

	const runtime: BrokerRuntime = {
		async mkdir(_target: string) {},
		async readFile(target: string) {
			const value = state.files.get(target);
			if (value === undefined) throw new Error(`missing file: ${target}`);
			return value;
		},
		async runCommand(args: string[]) {
			state.commands.push(args);
			return commandHandler(args, state);
		},
		async setSocketPermissions(_socketPath: string, _primaryUser: string) {},
		async unlink(target: string) {
			state.files.delete(target);
		},
		async writeFile(target: string, content: string) {
			state.files.set(target, content);
		},
		now() {
			return state.now;
		},
		stdout(_message: string) {},
		stderr(_message: string) {},
	};

	return { runtime, state };
}

describe("parseDuration", () => {
	it("parses minute, hour, and bare-minute specs", () => {
		expect(parseDuration("5m")).toBe(300);
		expect(parseDuration("2h")).toBe(7200);
		expect(parseDuration("10")).toBe(600);
	});
});

describe("broker autonomy", () => {
	it("elevates after grant-admin and drops after revoke-admin", async () => {
		const { runtime, state } = createRuntime(async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }));

		expect(await currentAutonomy(runtime, baseConfig)).toBe("maintain");
		await grantAdmin(runtime, baseConfig, "5m");
		expect(await currentAutonomy(runtime, baseConfig)).toBe("admin");
		expect(await brokerStatus(runtime, baseConfig)).toEqual({
			defaultAutonomy: "maintain",
			effectiveAutonomy: "admin",
			elevatedUntil: 1300,
		});
		await revokeAdmin(runtime, baseConfig);
		expect(await currentAutonomy(runtime, baseConfig)).toBe("maintain");
		expect(state.files.has(baseConfig.elevationPath)).toBe(false);
	});
});

describe("handleRequest", () => {
	it("allows observe-level status on an allowed unit", async () => {
		const config = { ...baseConfig, defaultAutonomy: "observe" as const };
		const { runtime, state } = createRuntime(async () => ({
			ok: true,
			stdout: "active",
			stderr: "",
			exitCode: 0,
		}));

		const result = await handleRequest(runtime, config, {
			operation: "systemd",
			action: "status",
			unit: "nixpi-ttyd.service",
		});

		expect(result.stdout).toBe("active");
		expect(state.commands).toEqual([["systemctl", "status", "--no-pager", "nixpi-ttyd.service"]]);
	});

	it("rejects non-allowlisted units", async () => {
		const { runtime } = createRuntime(async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }));

		await expect(
			handleRequest(runtime, baseConfig, {
				operation: "systemd",
				action: "status",
				unit: "sshd.service",
			}),
		).rejects.toBeInstanceOf(PermissionError);
	});

	it("blocks admin-only update operations for maintain autonomy", async () => {
		const { runtime } = createRuntime(async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }));

		await expect(
			handleRequest(runtime, baseConfig, {
				operation: "nixos-update",
				action: "rollback",
			}),
		).rejects.toBeInstanceOf(PermissionError);
	});

	it("returns the explicit os-update disable error after elevation", async () => {
		const config = { ...baseConfig, osUpdateEnable: false };
		const { runtime } = createRuntime(async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }), {
			files: new Map([[config.elevationPath, JSON.stringify({ until: 5000, grantedAt: 1000 })]]),
		});

		await expect(
			handleRequest(runtime, config, {
				operation: "nixos-update",
				action: "apply",
			}),
		).rejects.toEqual(new PermissionError("OS updates are disabled"));
	});

	it("always uses the configured default flake for apply", async () => {
		const { runtime, state } = createRuntime(
			async () => ({
				ok: true,
				stdout: "",
				stderr: "",
				exitCode: 0,
			}),
			{
				files: new Map([[baseConfig.elevationPath, JSON.stringify({ until: 5000, grantedAt: 1000 })]]),
			},
		);

		await handleRequest(runtime, baseConfig, {
			operation: "nixos-update",
			action: "apply",
			flake: "evil#host",
		});

		expect(state.commands).toEqual([["nixos-rebuild", "switch", "--flake", baseConfig.defaultFlake]]);
	});

	it("clamps reboot scheduling to one week", async () => {
		const { runtime, state } = createRuntime(
			async (_args) => ({
				ok: true,
				stdout: "",
				stderr: "",
				exitCode: 0,
			}),
			{
				files: new Map([[baseConfig.elevationPath, JSON.stringify({ until: 5000, grantedAt: 1000 })]]),
			},
		);

		await handleRequest(runtime, baseConfig, {
			operation: "schedule-reboot",
			minutes: 999999,
		});

		expect(state.commands).toEqual([["systemd-run", "--on-active=10080m", "systemctl", "reboot"]]);
	});
});
