/** Shell command execution via node:child_process with signal/env support. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Result of running a shell command via {@link run}. */
export interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Execute a command with arguments, returning stdout, stderr, and exit code.
 * Never throws — failed commands return a non-zero exitCode with stderr populated.
 *
 * @param cmd - The executable to run.
 * @param args - Arguments passed to the executable.
 * @param signal - Optional AbortSignal to cancel the process.
 * @param cwd - Optional working directory for the child process.
 * @param env - Optional extra environment variables (merged with process.env).
 * @param input - Optional string to pipe to the process's stdin.
 */
export async function run(
	cmd: string,
	args: string[],
	signal?: AbortSignal,
	cwd?: string,
	env?: Record<string, string>,
	input?: string,
): Promise<RunResult> {
	try {
		const result = await execFileAsync(cmd, args, {
			signal,
			cwd,
			env: env ? { ...process.env, ...env } : undefined,
			maxBuffer: 10 * 1024 * 1024,
			...(input !== undefined ? { input } : {}),
		});
		return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: 0 };
	} catch (err: unknown) {
		const e = err as { code?: number | string; stdout?: string; stderr?: string };
		const exitCode = typeof e.code === "number" ? e.code : 1;
		return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode };
	}
}
