import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run, type RunResult } from "../../../lib/exec.js";
import { getSystemFlakeDir } from "../../../lib/filesystem.js";
import { requireConfirmation } from "../../../lib/interactions.js";
import { type ActionResult, err, ok, truncate } from "../../../lib/utils.js";
import type { RepoCommandDetails, RepoSetupDetails, RepoStatusDetails, RepoValidationDetails } from "./types.js";

type NixConfigProposalAction = "setup" | "status" | "validate" | "commit" | "push" | "apply";

const DEFAULT_CHECK = "checks.x86_64-linux.config";
const LOCAL_REPO_DIR = "/var/lib/nixpi/pi-nixpi";
const REMOTE_REPO_URL = "https://github.com/alexradunet/NixPI.git";
const DEFAULT_REMOTE = "origin";
const DEFAULT_COMMIT_MESSAGE = "Update NixPI repository state";
const SUDO_COMMAND = "/run/wrappers/bin/sudo";

interface RepoState {
	created: boolean;
	source: string;
}

interface CloneSource {
	source: string;
}

type RepoInspection = RepoState | { error: string };

function missingRepoError(repoDir: string): string {
	return `Local NixPI repo is not initialized: ${repoDir}. Run nix_config_proposal with action "setup" first.`;
}

function summarizeOutput(result: { stdout: string; stderr: string; exitCode: number }): string {
	return truncate((result.stdout || result.stderr || "").trim() || "(no output)");
}

interface BrokerStatus {
	effectiveAutonomy?: string;
}

async function loadBrokerStatus(signal: AbortSignal | undefined): Promise<BrokerStatus | { error: string }> {
	const status = await run("nixpi-brokerctl", ["status"], signal);
	if (status.exitCode !== 0) {
		return { error: `Failed to inspect broker autonomy:\n${summarizeOutput(status)}` };
	}

	try {
		const parsed = JSON.parse(status.stdout || status.stderr) as BrokerStatus;
		if (typeof parsed?.effectiveAutonomy !== "string") {
			return { error: `Unexpected broker status output:\n${summarizeOutput(status)}` };
		}
		return parsed;
	} catch {
		return { error: `Unexpected broker status output:\n${summarizeOutput(status)}` };
	}
}

async function runWithTemporaryBrokerAdmin(
	purpose: string,
	signal: AbortSignal | undefined,
	runOperation: () => Promise<RunResult>,
): Promise<{ result: RunResult; cleanupWarning?: string } | { error: string }> {
	const status = await loadBrokerStatus(signal);
	if ("error" in status) return status;
	if (status.effectiveAutonomy === "admin") {
		return { result: await runOperation() };
	}

	const grant = await run(SUDO_COMMAND, ["-n", "nixpi-brokerctl", "grant-admin", "5m"], signal);
	if (grant.exitCode !== 0) {
		return {
			error:
				`Unable to obtain temporary admin autonomy for ${purpose}:\n${summarizeOutput(grant)}\n\n` +
				`Try again from the primary operator account or repair the sudo rule for nixpi-brokerctl grant-admin.`,
		};
	}

	const result = await runOperation();
	const revoke = await run(SUDO_COMMAND, ["-n", "nixpi-brokerctl", "revoke-admin"], signal);
	if (revoke.exitCode !== 0) {
		return {
			result,
			cleanupWarning:
				`Warning: ${purpose} completed, but temporary admin autonomy could not be revoked:\n${summarizeOutput(revoke)}`,
		};
	}

	return { result };
}

function initializedFrom(repo: RepoState): string[] {
	return repo.created ? [`Initialized from: ${repo.source}`, ""] : [];
}

function inspectRepo(repoDir: string): RepoInspection {
	if (existsSync(join(repoDir, ".git"))) {
		return { created: false, source: repoDir };
	}

	if (existsSync(repoDir) && readdirSync(repoDir).length > 0) {
		return { error: `Local NixPI repo path exists but is not a git clone: ${repoDir}` };
	}

	return { error: missingRepoError(repoDir) };
}

function resolveCloneSource(systemFlakeDir = getSystemFlakeDir()): CloneSource {
	return existsSync(join(systemFlakeDir, ".git")) ? { source: systemFlakeDir } : { source: REMOTE_REPO_URL };
}

async function ensureRepo(repoDir: string, signal: AbortSignal | undefined): Promise<RepoState | { error: string }> {
	const existing = inspectRepo(repoDir);
	if (!("error" in existing)) return existing;

	if (existsSync(repoDir)) {
		if (!existing.error.startsWith("Local NixPI repo is not initialized")) return existing;
	} else {
		mkdirSync(dirname(repoDir), { recursive: true });
	}

	const cloneSource = resolveCloneSource();
	const clone = await run("git", ["clone", cloneSource.source, repoDir], signal);
	if (clone.exitCode !== 0) {
		return { error: `Failed to create local NixPI repo at ${repoDir}:\n${summarizeOutput(clone)}` };
	}

	return { created: true, source: cloneSource.source };
}

function requireRepo(repoDir: string): RepoState | { error: string } {
	return inspectRepo(repoDir);
}

function parseRemoteName(remoteOutput: string): string {
	const firstLine = remoteOutput
		.split("\n")
		.map((line) => line.trim())
		.find(Boolean);
	return firstLine?.split(/\s+/)[0] || DEFAULT_REMOTE;
}

async function handleRepoSetup(
	repoDir: string,
	signal: AbortSignal | undefined,
): Promise<ActionResult<RepoSetupDetails>> {
	const existing = requireRepo(repoDir);
	if (!("error" in existing)) {
		return ok({
			text: `Local NixPI repo already initialized: ${repoDir}`,
			details: { repoDir, created: false, source: existing.source },
		});
	}

	if (!existing.error.startsWith("Local NixPI repo is not initialized")) {
		return err(existing.error);
	}

	const repo = await ensureRepo(repoDir, signal);
	if ("error" in repo) {
		return err(repo.error);
	}

	return ok({
		text: [`Initialized local NixPI repo: ${repoDir}`, ...initializedFrom(repo)].join("\n"),
		details: { repoDir, created: repo.created, source: repo.source },
	});
}

async function handleRepoStatus(
	repoDir: string,
	repo: RepoState,
	signal: AbortSignal | undefined,
): Promise<ActionResult<RepoStatusDetails>> {
	const [branch, remote, status, diff] = await Promise.all([
		run("git", ["branch", "--show-current"], signal, repoDir),
		run("git", ["remote", "-v"], signal, repoDir),
		run("git", ["status", "--short"], signal, repoDir),
		run("git", ["diff", "--stat", "--", "flake.nix", "flake.lock", "core/os"], signal, repoDir),
	]);

	const branchName = (branch.stdout || branch.stderr).trim() || "(detached or unknown)";
	const remoteName = parseRemoteName(remote.stdout || remote.stderr);
	const lines = [
		`Local NixPI repo: ${repoDir}`,
		...initializedFrom(repo),
		`Branch: ${branchName}`,
		`Remote: ${remoteName}`,
		"",
		"Working tree:",
		status.stdout.trim() || "Clean",
		"",
		"Nix-related diff:",
		diff.stdout.trim() || "No diff in flake.nix, flake.lock, or core/os.",
	];

	return ok({
		text: truncate(lines.join("\n")),
		details: {
			repoDir,
			branch: branch.stdout.trim(),
			remote: remoteName,
			clean: status.stdout.trim().length === 0,
		},
	});
}

async function handleRepoValidation(
	repoDir: string,
	repo: RepoState,
	signal: AbortSignal | undefined,
): Promise<ActionResult<RepoValidationDetails>> {
	const [flakeCheck, configBuild] = await Promise.all([
		run("nix", ["flake", "check", "--no-build"], signal, repoDir),
		run("nix", ["build", `.#${DEFAULT_CHECK}`, "--no-link"], signal, repoDir),
	]);
	const allOk = flakeCheck.exitCode === 0 && configBuild.exitCode === 0;
	const text = [
		`Validated local NixPI repo at ${repoDir}`,
		...initializedFrom(repo),
		"",
		`nix flake check --no-build: ${flakeCheck.exitCode === 0 ? "ok" : "failed"}`,
		summarizeOutput(flakeCheck),
		"",
		`nix build .#${DEFAULT_CHECK} --no-link: ${configBuild.exitCode === 0 ? "ok" : "failed"}`,
		summarizeOutput(configBuild),
	].join("\n");

	if (!allOk) return err(truncate(text));
	return ok({
		text: truncate(text),
		details: { repoDir, flakeCheck: flakeCheck.exitCode, configBuild: configBuild.exitCode },
	});
}

async function handleRepoCommit(
	repoDir: string,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
): Promise<ActionResult<RepoCommandDetails>> {
	const denied = await requireConfirmation(ctx, `Create a Git commit in ${repoDir}`);
	if (denied) return err(denied);

	const status = await run("git", ["status", "--short"], signal, repoDir);
	if (status.exitCode !== 0) return err(`git status failed:\n${summarizeOutput(status)}`);
	if (!status.stdout.trim()) return err("No local changes to commit.");

	const add = await run("git", ["add", "-A"], signal, repoDir);
	if (add.exitCode !== 0) return err(`git add failed:\n${summarizeOutput(add)}`);

	const commit = await run("git", ["commit", "-m", DEFAULT_COMMIT_MESSAGE], signal, repoDir);
	if (commit.exitCode !== 0) return err(`git commit failed:\n${summarizeOutput(commit)}`);

	return ok({
		text: truncate(`Created commit in ${repoDir}.\n\n${summarizeOutput(commit)}`),
		details: { repoDir, exitCode: commit.exitCode },
	});
}

async function handleRepoPush(
	repoDir: string,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
): Promise<ActionResult<RepoCommandDetails>> {
	const denied = await requireConfirmation(ctx, `Push the current branch from ${repoDir}`);
	if (denied) return err(denied);

	const branch = await run("git", ["branch", "--show-current"], signal, repoDir);
	const branchName = branch.stdout.trim();
	if (branch.exitCode !== 0 || !branchName) {
		return err(`Unable to determine current branch:\n${summarizeOutput(branch)}`);
	}

	const push = await run("git", ["push", DEFAULT_REMOTE, branchName], signal, repoDir);
	if (push.exitCode !== 0) return err(`git push failed:\n${summarizeOutput(push)}`);

	return ok({
		text: truncate(`Pushed ${branchName} to ${DEFAULT_REMOTE} from ${repoDir}.\n\n${summarizeOutput(push)}`),
		details: { repoDir, exitCode: push.exitCode },
	});
}

async function handleRepoApply(
	repoDir: string,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
): Promise<ActionResult<RepoCommandDetails>> {
	const denied = await requireConfirmation(ctx, `Apply NixPI repo state from ${repoDir}`);
	if (denied) return err(denied);

	const systemFlakeDir = getSystemFlakeDir();
	if (!existsSync(join(systemFlakeDir, "flake.nix"))) {
		return err(
			`System flake not found at ${systemFlakeDir}. The installed host flake at ${systemFlakeDir} is the running system's source of truth. ` +
				`Repair or reinstall that installed host flake before applying local repo overrides.`,
		);
	}

	const flake = `${systemFlakeDir}#nixos`;
	const repoRef = `path:${repoDir}`;
	const apply = await runWithTemporaryBrokerAdmin(
		`apply local NixPI repo state from ${repoDir}`,
		signal,
		() => run("nixpi-brokerctl", ["nixos-update", "apply", flake, "--override-input", "nixpi", repoRef], signal),
	);
	if ("error" in apply) return err(apply.error);
	if (apply.result.exitCode !== 0) {
		const failure = `Failed to apply local repo state from ${repoDir} through ${flake}:\n${summarizeOutput(apply.result)}`;
		return err(apply.cleanupWarning ? `${failure}\n\n${apply.cleanupWarning}` : failure);
	}

	const text = truncate(
		[
			`Applied local NixPI repo state from ${repoDir} by overriding nixpi in ${flake}.`,
			"",
			summarizeOutput(apply.result),
			...(apply.cleanupWarning ? ["", apply.cleanupWarning] : []),
		].join("\n"),
	);
	return ok({
		text,
		details: { repoDir, exitCode: apply.result.exitCode },
	});
}

export async function handleNixConfigProposal(
	action: NixConfigProposalAction,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
): Promise<ActionResult<RepoSetupDetails | RepoStatusDetails | RepoCommandDetails | RepoValidationDetails>> {
	const repoDir = LOCAL_REPO_DIR;
	if (action === "setup") {
		return handleRepoSetup(repoDir, signal);
	}

	const repo = requireRepo(repoDir);
	if ("error" in repo) {
		return err(repo.error);
	}

	switch (action) {
		case "status":
			return handleRepoStatus(repoDir, repo, signal);
		case "validate":
			return handleRepoValidation(repoDir, repo, signal);
		case "commit":
			return handleRepoCommit(repoDir, signal, ctx);
		case "push":
			return handleRepoPush(repoDir, signal, ctx);
		case "apply":
			return handleRepoApply(repoDir, signal, ctx);
	}
}
