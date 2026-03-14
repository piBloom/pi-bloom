/**
 * Test, PR submission, and artifact push handlers: run tests, submit PRs, push skills/services/extensions, install packages.
 *
 * @module actions-pr
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path, { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../core/lib/exec.js";
import { getBloomDir } from "../../core/lib/filesystem.js";
import { safePathWithin } from "../../core/lib/fs-utils.js";
import { slugifyBranchPart } from "../../core/lib/git.js";
import { errorResult, requireConfirmation, truncate } from "../../core/lib/shared.js";
import type { DevTestResult } from "./types.js";

/** Run tests and linting against the local repo. */
export async function handleDevTest(repoDir: string, signal?: AbortSignal) {
	const packageJson = join(repoDir, "package.json");
	if (!existsSync(packageJson)) {
		return errorResult(`package.json not found at ${packageJson}. Is the repo cloned?`);
	}

	const testResult = await run("npm", ["run", "test", "--", "--run"], signal, repoDir);
	const testsPassed = testResult.exitCode === 0;
	const testOutput = truncate(testResult.stdout + (testResult.stderr ? `\n${testResult.stderr}` : ""));

	const lintResult = await run("npm", ["run", "check"], signal, repoDir);
	const lintPassed = lintResult.exitCode === 0;
	const lintOutput = truncate(lintResult.stdout + (lintResult.stderr ? `\n${lintResult.stderr}` : ""));

	const success = testsPassed && lintPassed;
	const lines: string[] = [];
	lines.push(`Tests: ${testsPassed ? "PASSED" : "FAILED"}`);
	lines.push(`Lint: ${lintPassed ? "PASSED" : "FAILED"}`);
	if (!testsPassed) lines.push(`\n--- Test output ---\n${testOutput}`);
	if (!lintPassed) lines.push(`\n--- Lint output ---\n${lintOutput}`);

	const details: DevTestResult = { success, testsPassed, lintPassed, testOutput, lintOutput };
	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details,
		...(success ? {} : { isError: true }),
	};
}

/** Submit a pull request from local changes, including test results in the body. */
export async function handleDevSubmitPr(
	params: { title: string; body?: string; branch?: string },
	repoDir: string,
	signal?: AbortSignal,
	ctx?: ExtensionContext,
) {
	const gitDir = join(repoDir, ".git");
	if (!existsSync(gitDir)) {
		return errorResult(`No .git directory found at ${repoDir}. Is the repo cloned?`);
	}

	if (ctx) {
		const denied = await requireConfirmation(ctx, `Create PR "${params.title}" from currently staged repo changes`, {
			requireUi: false,
		});
		if (denied) return errorResult(denied);
	}

	// Run tests for PR body
	const testResult = await handleDevTest(repoDir, signal);
	const testSummary =
		"isError" in testResult && testResult.isError ? `Tests: FAILED\n${testResult.content[0].text}` : `Tests: PASSED`;

	// Branch
	const branch = params.branch || `dev/${slugifyBranchPart(params.title) || "patch"}`;
	const checkout = await run("git", ["-C", repoDir, "checkout", "-b", branch], signal);
	if (checkout.exitCode !== 0) {
		return errorResult(`Failed to create branch ${branch}: ${checkout.stderr}`);
	}

	const status = await run("git", ["-C", repoDir, "status", "--short"], signal);
	const unstaged = status.stdout
		.split("\n")
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.filter((line) => line.startsWith("??") || line.startsWith(" M") || line.startsWith(" D"));
	if (unstaged.length > 0) {
		return errorResult(
			[
				"Refusing to submit PR with unstaged or untracked changes.",
				"Stage the intended files first.",
				"",
				unstaged.join("\n"),
			].join("\n"),
		);
	}

	const staged = await run("git", ["-C", repoDir, "diff", "--cached", "--name-only"], signal);
	if (!staged.stdout.trim()) {
		return errorResult("No staged changes found. Stage the intended files first.");
	}

	const commit = await run("git", ["-C", repoDir, "commit", "-m", params.title], signal);
	if (commit.exitCode !== 0) {
		return errorResult(`Failed to commit: ${commit.stderr}`);
	}

	// Push
	const push = await run("git", ["-C", repoDir, "push", "-u", "origin", branch], signal);
	if (push.exitCode !== 0) {
		return errorResult(`Failed to push branch ${branch}: ${push.stderr}`);
	}

	// Create PR
	const body = [params.body || `## Summary\n${params.title}`, "", "## Test Results", testSummary].join("\n");

	const pr = await run("gh", ["pr", "create", "--title", params.title, "--body", body], signal, repoDir);
	if (pr.exitCode !== 0) {
		return errorResult(`Failed to create PR: ${pr.stderr}`);
	}

	const prUrl = pr.stdout.trim();
	return {
		content: [{ type: "text" as const, text: `PR created: ${prUrl}\nBranch: ${branch}` }],
		details: { prUrl, branch },
	};
}

/** Push a skill from ~/Bloom/Skills/ into the repo and submit a PR. */
export async function handleDevPushSkill(
	params: { skill_name: string; title?: string },
	repoDir: string,
	signal?: AbortSignal,
	ctx?: ExtensionContext,
) {
	const bloomDir = getBloomDir();
	const skillSrc = join(bloomDir, "Skills", params.skill_name);
	if (!existsSync(skillSrc)) {
		return errorResult(`Skill not found at ${skillSrc}`);
	}

	const skillDest = join(repoDir, "core", "skills", params.skill_name);
	mkdirSync(skillDest, { recursive: true });
	cpSync(skillSrc, skillDest, { recursive: true });

	const title = params.title || `feat(skills): add ${params.skill_name}`;
	return handleDevSubmitPr({ title }, repoDir, signal, ctx);
}

/** Push a service into the repo and submit a PR. */
export async function handleDevPushService(
	params: { service_name: string; title?: string },
	repoDir: string,
	signal?: AbortSignal,
	ctx?: ExtensionContext,
) {
	const bloomDir = getBloomDir();
	const candidates = [join(bloomDir, "services", params.service_name), join(repoDir, "services", params.service_name)];
	const serviceSrc = candidates.find((p) => existsSync(p));
	if (!serviceSrc) {
		return errorResult(`Service ${params.service_name} not found in ~/Bloom/services/ or repo services/`);
	}

	const serviceDest = join(repoDir, "services", params.service_name);
	if (serviceSrc !== serviceDest) {
		mkdirSync(serviceDest, { recursive: true });
		cpSync(serviceSrc, serviceDest, { recursive: true });
	}

	const title = params.title || `feat(services): add ${params.service_name}`;
	return handleDevSubmitPr({ title }, repoDir, signal, ctx);
}

/** Push an extension into the repo and submit a PR. */
export async function handleDevPushExtension(
	params: { extension_name: string; source_path?: string; title?: string },
	repoDir: string,
	signal?: AbortSignal,
	ctx?: ExtensionContext,
) {
	const bloomDir = getBloomDir();
	const extensionsRoot = join(bloomDir, "extensions");
	const candidates = [
		resolveExtensionSourcePath(extensionsRoot, params.extension_name, params.source_path),
		join(extensionsRoot, params.extension_name),
	].filter(Boolean) as string[];
	const extSrc = candidates.find((p) => existsSync(p));
	if (!extSrc) {
		return errorResult(`Extension ${params.extension_name} not found`);
	}

	const extDest = join(repoDir, "extensions", params.extension_name);
	mkdirSync(extDest, { recursive: true });
	cpSync(extSrc, extDest, { recursive: true });

	const title = params.title || `feat(extensions): add ${params.extension_name}`;
	return handleDevSubmitPr({ title }, repoDir, signal, ctx);
}

function resolveExtensionSourcePath(extensionsRoot: string, extensionName: string, sourcePath?: string): string | null {
	if (!sourcePath?.trim()) return null;
	const resolvedInput = path.isAbsolute(sourcePath) ? sourcePath : join(extensionsRoot, sourcePath);
	const relative = path.relative(extensionsRoot, resolvedInput);
	try {
		return safePathWithin(extensionsRoot, relative || extensionName);
	} catch {
		return null;
	}
}

/** Detect immutable-OS npm global install failures and related mkdir errors under /usr/local. */
export function isImmutableGlobalNpmError(output: string): boolean {
	const text = output.toLowerCase();
	return (
		text.includes("/usr/local/lib/node_modules") &&
		(text.includes("read-only file system") ||
			text.includes(" erofs") ||
			text.includes(" enoent") ||
			text.includes("mkdir"))
	);
}

/** Install a Pi package from a local path or URL. */
export async function handleDevInstallPackage(params: { source: string }, signal?: AbortSignal) {
	const source = params.source.trim();
	if (!source) {
		return errorResult("source must be a non-empty path or URL.");
	}

	// First try global install (default pi behavior).
	const globalResult = await run("pi", ["install", source], signal);
	if (globalResult.exitCode === 0) {
		return {
			content: [{ type: "text" as const, text: `Package installed from ${source}.\n${truncate(globalResult.stdout)}` }],
			details: { source, scope: "global", success: true },
		};
	}

	const combined = `${globalResult.stderr || ""}\n${globalResult.stdout || ""}`;
	if (!isImmutableGlobalNpmError(combined)) {
		return errorResult(`pi install failed: ${truncate(globalResult.stderr || globalResult.stdout)}`);
	}

	// On immutable systems, fall back to project-local install under ~/Bloom.
	const bloomDir = getBloomDir();
	const localResult = await run("pi", ["install", "-l", source], signal, bloomDir);
	if (localResult.exitCode !== 0) {
		return errorResult(
			[
				"Global install failed on immutable filesystem and local fallback also failed.",
				"Try manually: pi install -l <source>",
				"--- global error ---",
				truncate(globalResult.stderr || globalResult.stdout),
				"--- local error ---",
				truncate(localResult.stderr || localResult.stdout),
			].join("\n"),
		);
	}

	return {
		content: [
			{
				type: "text" as const,
				text: [
					`Global install blocked by immutable OS (/usr/local is read-only).`,
					`Installed package from ${source} using local scope (-l) in ${bloomDir}.`,
					truncate(localResult.stdout),
				].join("\n"),
			},
		],
		details: { source, scope: "local", cwd: bloomDir, success: true },
	};
}
