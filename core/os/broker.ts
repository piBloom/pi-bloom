import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LEVELS = { observe: 0, maintain: 1, admin: 2 } as const;
const SYSTEMD_UNIT_ALIASES: Record<string, string> = {
	"nixpi-update.service": "nixos-upgrade.service",
};

export type AutonomyLevel = keyof typeof LEVELS;

export interface BrokerConfig {
	socketPath: string;
	elevationPath: string;
	brokerStateDir: string;
	primaryUser: string;
	defaultAutonomy: AutonomyLevel;
	elevationDuration: string;
	osUpdateEnable: boolean;
	allowedUnits: string[];
	defaultFlake: string;
}

export interface BrokerCommandResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface ElevationRecord {
	until: number;
	grantedAt?: number;
}

export interface BrokerRuntime {
	mkdir(target: string): Promise<void>;
	readFile(target: string): Promise<string>;
	runCommand(args: string[]): Promise<BrokerCommandResult>;
	unlink(target: string): Promise<void>;
	writeFile(target: string, content: string): Promise<void>;
	now(): number;
	stdout(message: string): void;
	stderr(message: string): void;
}

export interface BrokerRequest {
	operation?: string;
	action?: string;
	unit?: string;
	flake?: string;
	minutes?: number;
}

export type BrokerListenTarget = string | { fd: number };

export function parseDuration(spec: string): number {
	if (spec.endsWith("m")) {
		return Number.parseInt(spec.slice(0, -1), 10) * 60;
	}
	if (spec.endsWith("h")) {
		return Number.parseInt(spec.slice(0, -1), 10) * 3600;
	}
	return Number.parseInt(spec, 10) * 60;
}

async function readJsonFile<T>(runtime: BrokerRuntime, target: string): Promise<T | null> {
	try {
		return JSON.parse(await runtime.readFile(target)) as T;
	} catch {
		return null;
	}
}

export async function loadElevation(runtime: BrokerRuntime, config: BrokerConfig): Promise<ElevationRecord | null> {
	const data = await readJsonFile<ElevationRecord>(runtime, config.elevationPath);
	if (!data || typeof data.until !== "number") {
		return null;
	}
	if (data.until <= runtime.now()) {
		await runtime.unlink(config.elevationPath).catch(() => undefined);
		return null;
	}
	return data;
}

export async function currentAutonomy(runtime: BrokerRuntime, config: BrokerConfig): Promise<AutonomyLevel> {
	if (config.defaultAutonomy === "admin") {
		return "admin";
	}
	if (await loadElevation(runtime, config)) {
		return "admin";
	}
	return config.defaultAutonomy;
}

async function ensureAllowedLevel(
	runtime: BrokerRuntime,
	config: BrokerConfig,
	required: AutonomyLevel,
): Promise<void> {
	if (LEVELS[await currentAutonomy(runtime, config)] < LEVELS[required]) {
		throw new PermissionError(`operation requires ${required} autonomy`);
	}
}

export class PermissionError extends Error {}

function resolveSystemdUnit(unit: string): string {
	return SYSTEMD_UNIT_ALIASES[unit] ?? unit;
}

async function handleSystemdRequest(
	runtime: BrokerRuntime,
	config: BrokerConfig,
	request: BrokerRequest,
): Promise<BrokerCommandResult> {
	const action = request.action;
	const unit = request.unit;
	if (typeof unit !== "string" || !config.allowedUnits.includes(unit)) {
		throw new PermissionError(`unit not allowed: ${unit}`);
	}
	const resolvedUnit = resolveSystemdUnit(unit);
	if (action === "status") {
		await ensureAllowedLevel(runtime, config, "observe");
		return runtime.runCommand(["systemctl", "show", "--no-pager", resolvedUnit]);
	}
	if (action === "start" || action === "stop" || action === "restart" || action === "enable-now") {
		await ensureAllowedLevel(runtime, config, "maintain");
		return runtime.runCommand(
			action === "enable-now"
				? ["systemctl", "enable", "--now", resolvedUnit]
				: ["systemctl", action, resolvedUnit],
		);
	}
	throw new Error(`unsupported systemd action: ${action}`);
}

async function handleNixosUpdateRequest(
	runtime: BrokerRuntime,
	config: BrokerConfig,
	request: BrokerRequest,
): Promise<BrokerCommandResult> {
	await ensureAllowedLevel(runtime, config, "admin");
	if (!config.osUpdateEnable) {
		throw new PermissionError("OS updates are disabled");
	}
	if (request.action === "rollback") {
		return runtime.runCommand(["nixos-rebuild", "switch", "--rollback"]);
	}
	if (request.action === "apply") {
		return runtime.runCommand(["nixos-rebuild", "switch", "--flake", config.defaultFlake]);
	}
	throw new Error(`unsupported nixos-update action: ${request.action}`);
}

async function handleScheduleRebootRequest(
	runtime: BrokerRuntime,
	config: BrokerConfig,
	request: BrokerRequest,
): Promise<BrokerCommandResult> {
	await ensureAllowedLevel(runtime, config, "admin");
	const minutes = Math.max(1, Math.min(Number(request.minutes ?? 1), 7 * 24 * 60));
	return runtime.runCommand(["systemd-run", `--on-active=${minutes}m`, "systemctl", "reboot"]);
}

export async function handleRequest(
	runtime: BrokerRuntime,
	config: BrokerConfig,
	request: BrokerRequest,
): Promise<BrokerCommandResult> {
	switch (request.operation) {
		case "systemd":
			return handleSystemdRequest(runtime, config, request);
		case "nixos-update":
			return handleNixosUpdateRequest(runtime, config, request);
		case "schedule-reboot":
			return handleScheduleRebootRequest(runtime, config, request);
		default:
			throw new Error(`unsupported operation: ${request.operation}`);
	}
}

export async function brokerStatus(runtime: BrokerRuntime, config: BrokerConfig) {
	const elevation = await loadElevation(runtime, config);
	return {
		defaultAutonomy: config.defaultAutonomy,
		effectiveAutonomy: await currentAutonomy(runtime, config),
		elevatedUntil: elevation?.until ?? null,
	};
}

export async function grantAdmin(runtime: BrokerRuntime, config: BrokerConfig, duration?: string) {
	const now = runtime.now();
	const until = now + parseDuration(duration || config.elevationDuration);
	await runtime.mkdir(config.brokerStateDir);
	await runtime.writeFile(config.elevationPath, JSON.stringify({ until, grantedAt: now }));
	return { effectiveAutonomy: "admin", until };
}

export async function revokeAdmin(runtime: BrokerRuntime, config: BrokerConfig) {
	await runtime.unlink(config.elevationPath).catch(() => undefined);
	return { effectiveAutonomy: config.defaultAutonomy };
}

async function receiveMessage(socket: net.Socket): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		socket.setEncoding("utf-8");
		socket.on("data", (chunk) => {
			data += chunk;
			if (data.endsWith("\n")) {
				resolve(data.trim());
			}
		});
		socket.on("error", reject);
		socket.on("close", () => resolve(data.trim()));
	});
}

export async function request(runtime: BrokerRuntime, config: BrokerConfig, payload: BrokerRequest): Promise<number> {
	const socket = net.createConnection(config.socketPath);
	const response = await new Promise<BrokerCommandResult>((resolve, reject) => {
		socket.on("connect", async () => {
			socket.write(`${JSON.stringify(payload)}\n`);
			try {
				const raw = await receiveMessage(socket);
				resolve((raw ? JSON.parse(raw) : {}) as BrokerCommandResult);
			} catch (error) {
				reject(error);
			} finally {
				socket.end();
			}
		});
		socket.on("error", reject);
	});

	runtime.stdout(response.stdout);
	runtime.stderr(response.stderr);
	return response.exitCode;
}

function parsePositiveInteger(value: string | undefined): number | null {
	if (!value || !/^\d+$/.test(value)) {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function systemdListenFd(env: NodeJS.ProcessEnv, pid: number): number | null {
	const listenPid = parsePositiveInteger(env.LISTEN_PID);
	const listenFds = parsePositiveInteger(env.LISTEN_FDS);
	if (listenPid !== pid || listenFds !== 1) {
		return null;
	}
	return 3;
}

export function brokerListenTarget(
	config: Pick<BrokerConfig, "socketPath">,
	env: NodeJS.ProcessEnv = process.env,
	pid = process.pid,
): BrokerListenTarget {
	const fd = systemdListenFd(env, pid);
	return fd === null ? config.socketPath : { fd };
}

export async function serve(
	runtime: BrokerRuntime,
	config: BrokerConfig,
	env: NodeJS.ProcessEnv = process.env,
	pid = process.pid,
): Promise<void> {
	await runtime.mkdir(config.brokerStateDir);
	const listenTarget = brokerListenTarget(config, env, pid);
	if (typeof listenTarget === "string") {
		await runtime.mkdir(new URL(".", `file://${config.socketPath}`).pathname).catch(() => undefined);
		await runtime.unlink(config.socketPath).catch(() => undefined);
	}

	const server = net.createServer((socket) => {
		void (async () => {
			try {
				const raw = await receiveMessage(socket);
				const requestPayload = (raw ? JSON.parse(raw) : {}) as BrokerRequest;
				const response = await handleRequest(runtime, config, requestPayload);
				socket.end(`${JSON.stringify(response)}\n`);
			} catch (error) {
				const response =
					error instanceof PermissionError
						? { ok: false, stdout: "", stderr: error.message, exitCode: 126 }
						: { ok: false, stdout: "", stderr: error instanceof Error ? error.message : String(error), exitCode: 1 };
				socket.end(`${JSON.stringify(response)}\n`);
			}
		})();
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		if (typeof listenTarget === "string") {
			server.listen(listenTarget, () => resolve());
			return;
		}
		server.listen(listenTarget, () => resolve());
	});
	await new Promise(() => undefined);
}

export async function main(runtime: BrokerRuntime, config: BrokerConfig, argv: string[]): Promise<number> {
	if (argv.length < 2) {
		runtime.stderr("usage: nixpi-broker <server|status|grant-admin|revoke-admin|systemd|nixos-update|schedule-reboot>");
		return 1;
	}

	const cmd = argv[1];
	if (cmd === "server") {
		await serve(runtime, config);
		return 0;
	}
	if (cmd === "status") {
		runtime.stdout(`${JSON.stringify(await brokerStatus(runtime, config))}\n`);
		return 0;
	}
	if (cmd === "grant-admin") {
		runtime.stdout(`${JSON.stringify(await grantAdmin(runtime, config, argv[2]))}\n`);
		return 0;
	}
	if (cmd === "revoke-admin") {
		runtime.stdout(`${JSON.stringify(await revokeAdmin(runtime, config))}\n`);
		return 0;
	}
	if (cmd === "systemd") {
		if (argv.length !== 4) {
			runtime.stderr("usage: nixpi-broker systemd <status|start|stop|restart|enable-now> <unit>");
			return 1;
		}
		return request(runtime, config, { operation: "systemd", action: argv[2], unit: argv[3] });
	}
	if (cmd === "nixos-update") {
		if (argv.length < 3) {
			runtime.stderr("usage: nixpi-broker nixos-update <apply|rollback> [flake]");
			return 1;
		}
		return request(runtime, config, { operation: "nixos-update", action: argv[2], flake: argv[3] });
	}
	if (cmd === "schedule-reboot") {
		if (argv.length !== 3) {
			runtime.stderr("usage: nixpi-broker schedule-reboot <minutes>");
			return 1;
		}
		return request(runtime, config, { operation: "schedule-reboot", minutes: Number.parseInt(argv[2], 10) });
	}
	runtime.stderr(`unknown command: ${cmd}`);
	return 1;
}

async function runCommand(args: string[]): Promise<BrokerCommandResult> {
	try {
		const result = await execFileAsync(args[0] ?? "", args.slice(1), { maxBuffer: 10 * 1024 * 1024 });
		return { ok: true, stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: 0 };
	} catch (error) {
		const result = error as { code?: number | string; stdout?: string; stderr?: string };
		return {
			ok: false,
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			exitCode: typeof result.code === "number" ? result.code : 1,
		};
	}
}

export const defaultBrokerRuntime: BrokerRuntime = {
	mkdir(target) {
		return fs.mkdir(target, { recursive: true }).then(() => undefined);
	},
	readFile(target) {
		return fs.readFile(target, "utf-8");
	},
	runCommand,
	unlink(target) {
		return fs.unlink(target).then(() => undefined);
	},
	writeFile(target, content) {
		return fs.writeFile(target, content, "utf-8");
	},
	now() {
		return Math.floor(Date.now() / 1000);
	},
	stdout(message) {
		if (message) process.stdout.write(message);
	},
	stderr(message) {
		if (message) process.stderr.write(message);
	},
};

export async function readBrokerConfig(env: NodeJS.ProcessEnv): Promise<BrokerConfig> {
	const configPath = env.NIXPI_BROKER_CONFIG;
	if (!configPath) {
		throw new Error("NIXPI_BROKER_CONFIG is required");
	}
	return JSON.parse(await fs.readFile(configPath, "utf-8")) as BrokerConfig;
}

export function isMainModule(argv1: string | undefined, moduleUrl: string): boolean {
	if (!argv1) return false;
	try {
		return argv1 === fileURLToPath(moduleUrl);
	} catch {
		return false;
	}
}

if (isMainModule(process.argv[1], import.meta.url)) {
	readBrokerConfig(process.env)
		.then((config) => main(defaultBrokerRuntime, config, process.argv.slice(1)))
		.then((exitCode) => {
			process.exitCode = exitCode;
		})
		.catch((error) => {
			process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
			process.exitCode = 1;
		});
}
