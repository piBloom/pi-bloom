import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../../core/lib/exec.js";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const deployScriptPath = path.join(repoRoot, "core/scripts/plain-host-deploy.sh");

function createDeployHarness() {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "plain-host-deploy-test-"));
	const argsPath = path.join(rootDir, "nixos-anywhere.args");
	const flakeCopyPath = path.join(rootDir, "generated-flake.nix");
	const stubPath = path.join(rootDir, "fake-nixos-anywhere.sh");

	fs.writeFileSync(
		stubPath,
		`#!/usr/bin/env bash
set -euo pipefail

printf '%s\\0' "$@" > "$NIXPI_TEST_ARGS_FILE"

flake_ref=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --flake)
      flake_ref="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

cp "\${flake_ref%%#*}/flake.nix" "$NIXPI_TEST_FLAKE_COPY"
`,
	);
	fs.chmodSync(stubPath, 0o755);

	return {
		rootDir,
		argsPath,
		flakeCopyPath,
		stubPath,
		cleanup() {
			fs.rmSync(rootDir, { recursive: true, force: true });
		},
	};
}

async function runDeploy(
	args: string[],
	overrides?: {
		cwd?: string;
		env?: Record<string, string>;
	},
) {
	const harness = createDeployHarness();
	const result = await run("bash", [deployScriptPath, ...args], undefined, overrides?.cwd ?? repoRoot, {
		NIXPI_NIXOS_ANYWHERE: harness.stubPath,
		NIXPI_TEST_ARGS_FILE: harness.argsPath,
		NIXPI_TEST_FLAKE_COPY: harness.flakeCopyPath,
		TMPDIR: harness.rootDir,
		...overrides?.env,
	});

	return {
		...result,
		harness,
		readArgs() {
			if (!fs.existsSync(harness.argsPath)) return [];
			return fs.readFileSync(harness.argsPath, "utf8").split("\0").filter(Boolean);
		},
		readGeneratedFlake() {
			return fs.readFileSync(harness.flakeCopyPath, "utf8");
		},
	};
}

afterEach(() => {
	delete process.env.NIXPI_REPO_ROOT;
});

describe("plain-host-deploy.sh", () => {
	it("exposes a sourceable pure flake builder for deterministic tests", async () => {
		const result = await run(
			"bash",
			["-lc", `source "${deployScriptPath}"; build_deploy_flake "path:${repoRoot}" "ovh-base" "plan-host" "/dev/vda"`],
			undefined,
			repoRoot,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(`inputs.nixpi.url = "path:${repoRoot}"`);
		expect(result.stdout).toContain("nixosConfigurations.deploy = nixpi.nixosConfigurations.ovh-base.extendModules");
		expect(result.stdout).toContain('networking.hostName = lib.mkForce "plan-host";');
		expect(result.stdout).toContain('disko.devices.disk.main.device = lib.mkForce "/dev/vda";');
		expect(result.stdout).not.toContain("nixpi.primaryUser");
		expect(result.stdout).not.toContain("initialHashedPassword");
		expect(result.stdout).not.toContain("nixpi.netbird");
	});

	it("keeps the pure flake builder free of nixpi-specific bootstrap overrides", async () => {
		const result = await run(
			"bash",
			["-lc", `source "${deployScriptPath}"; build_deploy_flake "path:${repoRoot}" "ovh-base" "plan-host" "/dev/vda"`],
			undefined,
			repoRoot,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).not.toContain("nixpi.primaryUser");
		expect(result.stdout).not.toContain("nixpi.security.ssh");
		expect(result.stdout).not.toContain("initialHashedPassword");
		expect(result.stdout).not.toContain("nixpi.netbird");
	});

	it("shows usage and exits non-zero when required arguments are missing", async () => {
		const result = await run("bash", [deployScriptPath], undefined, repoRoot);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Usage: plain-host-deploy");
	});

	it("defaults the generated deploy flake hostname to ovh-base", async () => {
		const result = await run(
			"bash",
			["-lc", `source "${deployScriptPath}"; build_deploy_flake "path:${repoRoot}" "ovh-base" "ovh-base" "/dev/vda"`],
			undefined,
			repoRoot,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('networking.hostName = lib.mkForce "ovh-base";');
	});

	it("rejects flake refs that do not include a nixosConfigurations attribute", async () => {
		const result = await runDeploy(["--target-host", "root@198.51.100.10", "--disk", "/dev/sda", "--flake", "."]);

		try {
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Flake ref must include a nixosConfigurations attribute");
			expect(result.readArgs()).toEqual([]);
		} finally {
			result.harness.cleanup();
		}
	});

	it("rejects flake refs that do not target the ovh-base profile", async () => {
		const result = await runDeploy(["--target-host", "root@198.51.100.10", "--disk", "/dev/sda", "--flake", ".#vps"]);

		try {
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Flake ref must target the ovh-base nixosConfigurations profile");
			expect(result.readArgs()).toEqual([]);
		} finally {
			result.harness.cleanup();
		}
	});

	it("rejects legacy nixpi-specific bootstrap arguments", async () => {
		const result = await runDeploy([
			"--target-host",
			"root@198.51.100.10",
			"--disk",
			"/dev/sda",
			"--bootstrap-user",
			"alice",
		]);

		try {
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Usage: plain-host-deploy");
			expect(result.stderr).toContain("Unsupported legacy option: --bootstrap-user");
			expect(result.readArgs()).toEqual([]);
		} finally {
			result.harness.cleanup();
		}
	});

	it.each([
		"--bootstrap-user=alice",
		"--bootstrap-password-hash=$6$hash",
		"--netbird-setup-key-file=./netbird-key",
	])("rejects legacy nixpi-specific bootstrap arguments passed as %s", async (legacyFlag) => {
		const result = await runDeploy(["--target-host", "root@198.51.100.10", "--disk", "/dev/sda", legacyFlag]);

		try {
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Usage: plain-host-deploy");
			expect(result.stderr).toContain(`Unsupported legacy option: ${legacyFlag.split("=")[0]}`);
			expect(result.readArgs()).toEqual([]);
		} finally {
			result.harness.cleanup();
		}
	});

	it("builds a temporary deploy flake and forwards deterministic nixos-anywhere arguments", async () => {
		const result = await runDeploy([
			"--target-host",
			"root@198.51.100.10",
			"--disk",
			"/dev/nvme0n1",
			"--hostname",
			"bloom-eu-1",
			"--debug",
			"--option",
			"accept-flake-config",
			"true",
		]);

		try {
			expect(result.exitCode).toBe(0);

			const args = result.readArgs();
			expect(args).toEqual([
				"--flake",
				expect.stringMatching(/#deploy$/),
				"--target-host",
				"root@198.51.100.10",
				"--debug",
				"--option",
				"accept-flake-config",
				"true",
			]);

			const generatedFlake = result.readGeneratedFlake();
			expect(generatedFlake).toContain(`inputs.nixpi.url = "path:${repoRoot}"`);
			expect(generatedFlake).toContain("nixosConfigurations.deploy = nixpi.nixosConfigurations.ovh-base.extendModules");
			expect(generatedFlake).toContain('networking.hostName = lib.mkForce "bloom-eu-1";');
			expect(generatedFlake).toContain('disko.devices.disk.main.device = lib.mkForce "/dev/nvme0n1";');
			expect(generatedFlake).not.toContain("nixpi.primaryUser");
			expect(generatedFlake).not.toContain("initialHashedPassword");
			expect(generatedFlake).not.toContain("nixpi.netbird");
		} finally {
			result.harness.cleanup();
		}
	});

	it("keeps packaged wrapper default flake resolution rooted at the repo checkout", () => {
		const packageNix = fs.readFileSync(path.join(repoRoot, "core/os/pkgs/plain-host-deploy/default.nix"), "utf8");

		expect(packageNix).toContain("--set NIXPI_REPO_ROOT ${../../../..}");
	});
});
