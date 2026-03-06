import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(execFile);

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
 */
export async function run(cmd: string, args: string[], signal?: AbortSignal, cwd?: string): Promise<RunResult> {
	try {
		const { stdout, stderr } = await execAsync(cmd, args, { signal, cwd });
		return { stdout, stderr, exitCode: 0 };
	} catch (err: unknown) {
		const e = err as { message?: string; stderr?: string; stdout?: string; code?: string | number; status?: number };
		const exitCode = typeof e.status === "number" ? e.status : typeof e.code === "number" ? e.code : 1;
		return {
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? e.message ?? String(err),
			exitCode,
		};
	}
}
