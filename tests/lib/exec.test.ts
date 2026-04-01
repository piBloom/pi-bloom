import { describe, expect, it } from "vitest";
import { run } from "../../core/lib/exec.js";

describe("run()", () => {
	it("returns stdout and exitCode 0 on success", async () => {
		const result = await run("echo", ["hello"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("hello");
		expect(result.stderr).toBe("");
	});

	it("returns non-zero exitCode for a failing command", async () => {
		const result = await run("false", []);
		expect(result.exitCode).not.toBe(0);
	});

	it("returns non-zero exitCode for a nonexistent command", async () => {
		const result = await run("__missing_no_such_command__", []);
		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).toBe("");
	});

	it("supports the cwd option", async () => {
		const result = await run("pwd", [], undefined, "/tmp");
		expect(result.exitCode).toBe(0);
		// /tmp may resolve to a symlink target on some systems
		expect(result.stdout.trim()).toMatch(/\/tmp/);
	});

	it("captures stderr from a failing command", async () => {
		const result = await run("ls", ["/__nonexistent_path_missing_test__"]);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.length).toBeGreaterThan(0);
	});

	it("passes arguments correctly", async () => {
		const result = await run("printf", ["%s-%s", "foo", "bar"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("foo-bar");
	});

	it("merges extra env variables with process.env", async () => {
		const result = await run("sh", ["-c", "echo $MY_TEST_VAR"], undefined, undefined, {
			MY_TEST_VAR: "hello-env",
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("hello-env");
	});

	it("passes the input option without error", async () => {
		// Verify that passing `input` doesn't throw; use a command that exits
		// immediately so we don't depend on stdin/EOF behavior across environments.
		const result = await run("echo", ["ok"], undefined, undefined, undefined, "ignored-input");
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("ok");
	});

	it("returns non-zero exit when aborted via AbortSignal", async () => {
		const controller = new AbortController();
		controller.abort();
		const result = await run("sleep", ["10"], controller.signal);
		expect(result.exitCode).not.toBe(0);
	});
});
