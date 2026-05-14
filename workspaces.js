import { readFileSync } from "node:fs";

function createWorkspaceState({ name, cwd, mode, sshHost, sshUser, context }) {
	return {
		name,
		cwd,
		mode,
		context,
		sshHost,
		sshUser,
		// Runtime state
		piProc: null,
		busy: false,
		piConnected: false,
		piHealthInterval: null,
		idleTimer: null,
		lineBuffer: "",
		requestId: 0,
		pendingRequests: new Map(),
		restarting: false,
		cachedCommands: [],
		currentSessionFile: null,
		currentSessionId: null,
		historyLoadPending: false,
		currentModel: null,
		currentThinkingLevel: "medium",
	};
}

function loadWorkspaceConfig(workspaceConfigPath) {
	if (!workspaceConfigPath) return null;
	try {
		const raw = readFileSync(workspaceConfigPath, "utf8");
		return JSON.parse(raw);
	} catch (e) {
		console.error(
			`  workspaces config: failed to load ${workspaceConfigPath}:`,
			e.message,
		);
		return null;
	}
}

export function createWorkspaceManager({
	workspaceConfigPath,
	cwd,
	idleTimeoutMs,
	broadcast,
	ensurePi,
}) {
	const workspaceConfig = loadWorkspaceConfig(workspaceConfigPath);
	const workspaces = new Map(); // name → workspace state
	let activeWorkspaceName = null;

	function initWorkspaces() {
		if (!workspaceConfig?.workspaces) {
			// Legacy single-workspace mode (no workspaces.json)
			workspaces.set(
				"default",
				createWorkspaceState({
					name: "default",
					cwd,
					mode: "local",
					context: "",
					sshHost: null,
					sshUser: "alex",
				}),
			);
			activeWorkspaceName = "default";
			return;
		}

		const defaultName =
			workspaceConfig.default || Object.keys(workspaceConfig.workspaces)[0];
		for (const [name, ws] of Object.entries(workspaceConfig.workspaces)) {
			workspaces.set(
				name,
				createWorkspaceState({
					name,
					cwd: ws.cwd || cwd,
					mode: ws.mode || "local",
					sshHost: ws.sshHost || null,
					sshUser: ws.sshUser || "alex",
					context: ws.context || "",
				}),
			);
		}
		activeWorkspaceName = defaultName;
	}

	function getActive() {
		return workspaces.get(activeWorkspaceName);
	}

	function clearIdleTimer(ws) {
		if (ws.idleTimer) {
			clearTimeout(ws.idleTimer);
			ws.idleTimer = null;
		}
	}

	// Kill a workspace's pi subprocess after idle timeout.
	function scheduleIdleKill(ws) {
		clearIdleTimer(ws);
		ws.idleTimer = setTimeout(() => {
			if (ws.piProc && !ws.piProc.killed && !ws.busy) {
				console.log(
					`  [idle] killing pi for workspace '${ws.name}' after ${idleTimeoutMs / 1000}s idle`,
				);
				ws.piProc.kill("SIGTERM");
				ws.piProc = null;
				ws.piConnected = false;
				broadcast({
					type: "pi_health",
					connected: false,
					busy: false,
					workspace: ws.name,
				});
			}
			ws.idleTimer = null;
		}, idleTimeoutMs);
	}

	function switchWorkspace(name) {
		if (!workspaces.has(name)) return;
		if (name === activeWorkspaceName) return;

		const oldWs = getActive();
		const newWs = workspaces.get(name);

		// Schedule idle kill for the old workspace's pi
		if (oldWs.piProc && !oldWs.piProc.killed && !oldWs.busy) {
			scheduleIdleKill(oldWs);
		}

		activeWorkspaceName = name;
		console.log(`  switched to workspace '${name}'`);

		// Notify all clients about the switch
		broadcast({
			type: "workspace_switched",
			workspace: name,
			workspaces: getWorkspacesInfo(),
		});

		// Ensure the new workspace has pi running
		ensurePi(newWs);
		clearIdleTimer(newWs);
	}

	function getWorkspacesInfo() {
		const result = {};
		for (const [name, ws] of workspaces) {
			result[name] = {
				name,
				cwd: ws.cwd,
				mode: ws.mode,
				context: ws.context,
				active: name === activeWorkspaceName,
				piConnected: ws.piConnected,
				busy: ws.busy,
			};
		}
		return result;
	}

	function getActiveWorkspaceName() {
		return activeWorkspaceName;
	}

	initWorkspaces();

	return {
		workspaces,
		getActive,
		clearIdleTimer,
		scheduleIdleKill,
		switchWorkspace,
		getWorkspacesInfo,
		getActiveWorkspaceName,
	};
}
