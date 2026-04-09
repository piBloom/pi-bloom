import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const flakePath = path.join(repoRoot, "flake.nix");
const packageJsonPath = path.join(repoRoot, "package.json");
const bootstrapHostScriptPath = path.join(repoRoot, "core/scripts/nixpi-bootstrap-host.sh");
const bootstrapHostPackagePath = path.join(repoRoot, "core/os/pkgs/nixpi-bootstrap-host/default.nix");
const rebuildPullScriptPath = path.join(repoRoot, "core/scripts/nixpi-rebuild-pull.sh");
const rebuildPullPackagePath = path.join(repoRoot, "core/os/pkgs/nixpi-rebuild-pull/default.nix");
const reinstallOvhScriptPath = path.join(repoRoot, "core/scripts/nixpi-reinstall-ovh.sh");
const reinstallOvhPackagePath = path.join(repoRoot, "core/os/pkgs/nixpi-reinstall-ovh/default.nix");
const ovhBaseHostPath = path.join(repoRoot, "core/os/hosts/ovh-base.nix");
const plainHostDeployProvisionerPackagePath = path.join(
	repoRoot,
	"nixos_vps_provisioner/pkgs/plain-host-deploy/default.nix",
);
const ovhSingleDiskProvisionerPresetPath = path.join(repoRoot, "nixos_vps_provisioner/presets/ovh-single-disk.nix");
const ovhVpsBaseProvisionerPresetPath = path.join(repoRoot, "nixos_vps_provisioner/presets/ovh-vps-base.nix");
const ovhVpsHostPath = path.join(repoRoot, "core/os/hosts/ovh-vps.nix");
const ovhBaseConfigTestPath = path.join(repoRoot, "tests/integration/ovh-base-config.test.ts");
const bootstrapHostTestPath = path.join(repoRoot, "tests/integration/nixpi-bootstrap-host.test.ts");
const ovhVpsConfigTestPath = path.join(repoRoot, "tests/integration/ovh-vps-config.test.ts");
const reinstallOvhTestPath = path.join(repoRoot, "tests/integration/nixpi-reinstall-ovh.test.ts");
const plainHostDeployProvisionerTestPath = path.join(repoRoot, "nixos_vps_provisioner/tests/plain-host-deploy.test.ts");
const ovhVpsBaseProvisionerConfigTestPath = path.join(
	repoRoot,
	"nixos_vps_provisioner/tests/ovh-vps-base-config.test.ts",
);
const provisionerAgentsPath = path.join(repoRoot, "nixos_vps_provisioner/AGENTS.md");
const appModulePath = path.join(repoRoot, "core/os/modules/app.nix");
const piPackagePath = path.join(repoRoot, "core/os/pkgs/pi/default.nix");
const shellModulePath = path.join(repoRoot, "core/os/modules/shell.nix");
const moduleSetsPath = path.join(repoRoot, "core/os/modules/module-sets.nix");
const runtimeFlowsPath = path.join(repoRoot, "docs/architecture/runtime-flows.md");
const daemonArchitecturePath = path.join(repoRoot, "docs/reference/daemon-architecture.md");
const serviceArchitecturePath = path.join(repoRoot, "docs/reference/service-architecture.md");
const personaSkillPath = path.join(repoRoot, "core/pi/persona/SKILL.md");
const recoverySkillPath = path.join(repoRoot, "core/pi/skills/recovery/SKILL.md");
const selfEvolutionSkillPath = path.join(repoRoot, "core/pi/skills/self-evolution/SKILL.md");
const readmePath = path.join(repoRoot, "README.md");
const plainHostInstallDocPath = path.join(repoRoot, "docs/install-plain-host.md");
const installDocPath = path.join(repoRoot, "docs/install.md");
const quickDeployDocPath = path.join(repoRoot, "docs/operations/quick-deploy.md");
const ovhRescueDeployDocPath = path.join(repoRoot, "docs/operations/ovh-rescue-deploy.md");
const firstBootDocPath = path.join(repoRoot, "docs/operations/first-boot-setup.md");
const liveTestingDocPath = path.join(repoRoot, "docs/operations/live-testing.md");
const infrastructureDocPath = path.join(repoRoot, "docs/reference/infrastructure.md");
const reinstallCommandPath = path.join(repoRoot, "reinstall-nixpi-command.txt");

const readUtf8 = (filePath: string) => readFileSync(filePath, "utf8");
const relativePath = (filePath: string) => path.relative(repoRoot, filePath);

const hostOwnedBootstrapDocCases = [
	{
		label: relativePath(readmePath),
		filePath: readmePath,
		contains: [
			"plain OVH-compatible NixOS base system",
			"plain-host-deploy",
			"nixpi-bootstrap-host",
			"`/etc/nixos` is the running host's source of truth",
		],
		absent: ["final host configuration installed directly by `nixos-anywhere`", "nixpi-rebuild-pull", "/srv/nixpi"],
	},
	{
		label: relativePath(plainHostInstallDocPath),
		filePath: plainHostInstallDocPath,
		contains: ["Install Plain Host", "plain-host-deploy", "standard NixOS host"],
		absent: ["nixpi-deploy-ovh", "final host configuration directly"],
	},
	{
		label: relativePath(installDocPath),
		filePath: installDocPath,
		contains: ["Install a plain host first", "run `nixpi-bootstrap-host` on the machine"],
		absent: ["final host configuration directly", "nixpi-deploy-ovh", "nixpi-rebuild-pull", "/srv/nixpi"],
	},
	{
		label: relativePath(quickDeployDocPath),
		filePath: quickDeployDocPath,
		contains: ["plain-host-deploy", "install the `ovh-vps-base`", "bootstrap NixPI after first boot"],
		absent: ["final `ovh-vps` host configuration directly", "nixpi-rebuild-pull", "/srv/nixpi"],
	},
	{
		label: relativePath(ovhRescueDeployDocPath),
		filePath: ovhRescueDeployDocPath,
		contains: ["plain base system", "run `nixpi-bootstrap-host` on the machine"],
		absent: ["nixpi-reinstall-ovh", "nixpi-rebuild-pull", "/srv/nixpi"],
	},
	{
		label: relativePath(firstBootDocPath),
		filePath: firstBootDocPath,
		contains: ["run `nixpi-bootstrap-host`", "`/etc/nixos#nixos`"],
		absent: ["nixpi-rebuild-pull", "<checkout-path>#ovh-vps", "/srv/nixpi"],
	},
	{
		label: relativePath(runtimeFlowsPath),
		filePath: runtimeFlowsPath,
		contains: ["plain base system", "bootstrap writes narrow `/etc/nixos` helper files"],
		absent: ["final host configuration directly", "nixpi-deploy-ovh", "nixpi-rebuild-pull", "/srv/nixpi"],
	},
	{
		label: relativePath(liveTestingDocPath),
		filePath: liveTestingDocPath,
		contains: ["base install then bootstrap", "`nixpi-bootstrap-host` on the machine"],
		absent: ["final `ovh-vps` host configuration directly", "nixpi-rebuild-pull", "/srv/nixpi"],
	},
	{
		label: relativePath(infrastructureDocPath),
		filePath: infrastructureDocPath,
		contains: ["nixpi-bootstrap-host", "`/etc/nixos` is the running host's source of truth"],
		absent: ["nixpi-rebuild-pull [branch]", "/srv/nixpi"],
	},
	{
		label: relativePath(personaSkillPath),
		filePath: personaSkillPath,
		contains: [
			"Canonical rebuild path: `sudo nixpi-rebuild`.",
			"Canonical bootstrap path: `nix run github:alexradunet/nixpi#nixpi-bootstrap-host -- ...`.",
		],
		absent: ["nixpi-deploy-ovh", "nixpi-rebuild-pull", "/srv/nixpi"],
	},
	{
		label: relativePath(recoverySkillPath),
		filePath: recoverySkillPath,
		contains: ["retry `sudo nixpi-rebuild`", "`sudo nixos-rebuild switch --flake /etc/nixos#nixos --impure`"],
		absent: ["nixpi-deploy-ovh", "nixpi-rebuild-pull", "/srv/nixpi"],
	},
	{
		label: relativePath(selfEvolutionSkillPath),
		filePath: selfEvolutionSkillPath,
		contains: [
			"**Standard bootstrap command**: `nix run github:alexradunet/nixpi#nixpi-bootstrap-host -- ...`",
			"**Canonical rebuild command**: `sudo nixpi-rebuild`",
		],
		absent: ["nixpi-deploy-ovh", "nixpi-rebuild-pull", "/srv/nixpi"],
	},
] as const;

const legacyBootstrapTerms = [
	"sudo nixpi-rebuild-pull [branch]",
	"sudo nixpi-rebuild-pull [branch-or-ref]",
	"nixpi-reinstall-ovh",
	"conventional `/srv/nixpi` operator checkout",
	"final `ovh-vps` host configuration directly",
	"<checkout-path>#ovh-vps",
	"/srv/nixpi",
] as const;

const legacyFreeDocCases = hostOwnedBootstrapDocCases.map(({ label, filePath }) => ({
	label,
	filePath,
	forbiddenTerms: legacyBootstrapTerms,
}));

describe("repo standards guards", () => {
	it("configures VitePress for GitHub Project Pages", () => {
		const vitePressConfig = readUtf8(path.join(repoRoot, "docs/.vitepress/config.ts"));

		expect(vitePressConfig).toContain('base: "/NixPI/"');
	});

	it("declares compatible Pi peer dependency ranges and CI checks", () => {
		const packageJson = JSON.parse(readUtf8(packageJsonPath)) as {
			peerDependencies?: Record<string, string>;
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
			scripts?: Record<string, string>;
		};

		expect(packageJson.peerDependencies).toMatchObject({
			"@mariozechner/pi-ai": "^0.60.0",
			"@mariozechner/pi-coding-agent": "^0.60.0",
		});
		expect(packageJson.scripts?.build).toBe("rm -rf dist && tsc --build");
		expect(packageJson.scripts?.["check:ci"]).toBe("biome ci .");
	});

	it("keeps Pi command execution shell-capable by including bash in wrapper PATH", () => {
		const piPackage = readUtf8(piPackagePath);
		const appModule = readUtf8(appModulePath);
		expect(piPackage).toContain("makeBinPath [ bash fd ripgrep ]");
		expect(appModule).toContain("pkgs.bash");
		expect(appModule).toContain("shellPath =");
		expect(appModule).toContain("/bin/bash");
		expect(appModule).toContain("systemd.tmpfiles.settings.nixpi-app");
		expect(appModule).toContain("systemd-tmpfiles");
	});

	it.each(hostOwnedBootstrapDocCases)("documents the host-owned bootstrap contract in $label", ({
		filePath,
		contains,
		absent,
	}) => {
		const doc = readUtf8(filePath);

		for (const expectedText of contains) {
			expect(doc).toContain(expectedText);
		}
		for (const unexpectedText of absent) {
			expect(doc).not.toContain(unexpectedText);
		}
	});

	it.each(legacyFreeDocCases)("keeps $label free of legacy repo-owned bootstrap terms", ({
		filePath,
		forbiddenTerms,
	}) => {
		const doc = readUtf8(filePath);

		for (const forbiddenTerm of forbiddenTerms) {
			expect(doc).not.toContain(forbiddenTerm);
		}
	});

	it("keeps the example install artifact aligned with the host-owned bootstrap flow", () => {
		const artifact = readUtf8(reinstallCommandPath);

		expect(artifact).toContain("# Day-0 base install from a local checkout");
		expect(artifact).toContain("nix run .#plain-host-deploy --");
		expect(artifact).toContain("nix run github:alexradunet/nixpi#nixpi-bootstrap-host --");
		for (const forbiddenTerm of ["nixpi-deploy-ovh", "nixpi-reinstall-ovh", "nixpi-rebuild-pull", "/srv/nixpi"]) {
			expect(artifact).not.toContain(forbiddenTerm);
		}
	});

	it("keeps production guidance free of exact legacy first-boot convergence phrases", () => {
		for (const filePath of [
			readmePath,
			installDocPath,
			quickDeployDocPath,
			ovhRescueDeployDocPath,
			firstBootDocPath,
			runtimeFlowsPath,
			liveTestingDocPath,
		]) {
			const doc = readUtf8(filePath);

			expect(doc).not.toContain("let first boot seed `/srv/nixpi` and `/etc/nixos/flake.nix`");
			expect(doc).not.toContain("a generated `/etc/nixos/flake.nix`");
		}
	});

	it("keeps only the host-owned bootstrap lane wired into the repo", () => {
		const flake = readUtf8(flakePath);

		expect(flake).toContain('disko.url = "github:nix-community/disko"');
		expect(flake).toContain('nixos-anywhere.url = "github:nix-community/nixos-anywhere"');
		expect(flake).toContain("nixpi-bootstrap-host = pkgs.callPackage ./core/os/pkgs/nixpi-bootstrap-host { };");
		expect(flake).toContain("plain-host-deploy = pkgs.callPackage ./nixos_vps_provisioner/pkgs/plain-host-deploy");
		expect(flake).toContain("ovh-vps-base = mkConfiguredStableSystem");
		expect(flake).toContain("./nixos_vps_provisioner/presets/ovh-single-disk.nix");
		expect(flake).toContain("./nixos_vps_provisioner/presets/ovh-vps-base.nix");
		expect(flake).toContain(`program = "\${self.packages.\${system}.nixpi-bootstrap-host}/bin/nixpi-bootstrap-host"`);
		expect(flake).toContain(`program = "\${self.packages.\${system}.plain-host-deploy}/bin/plain-host-deploy"`);

		expect(existsSync(bootstrapHostScriptPath)).toBe(true);
		expect(existsSync(bootstrapHostPackagePath)).toBe(true);
		expect(existsSync(bootstrapHostTestPath)).toBe(true);
		expect(existsSync(plainHostDeployProvisionerPackagePath)).toBe(true);
		expect(existsSync(ovhSingleDiskProvisionerPresetPath)).toBe(true);
		expect(existsSync(ovhVpsBaseProvisionerPresetPath)).toBe(true);
		expect(existsSync(plainHostDeployProvisionerTestPath)).toBe(true);
		expect(existsSync(ovhVpsBaseProvisionerConfigTestPath)).toBe(true);
		expect(existsSync(provisionerAgentsPath)).toBe(true);
		const provisionerAgents = readFileSync(provisionerAgentsPath, "utf-8");
		expect(provisionerAgents).toContain("Automation begins at first SSH access, not at the web-panel step.");
		expect(provisionerAgents).toContain("never auto-select a destructive target disk");
		expect(provisionerAgents).toContain("stop and ask for the human to perform OVH panel actions");

		expect(flake).not.toContain("nixpi-rebuild-pull");
		expect(flake).not.toContain("nixpi-reinstall-ovh");
		expect(flake).not.toContain("nixpi-deploy-ovh = pkgs.callPackage");
		expect(flake).not.toContain(`program = "\${self.packages.\${system}.nixpi-deploy-ovh}/bin/nixpi-deploy-ovh"`);
		expect(flake).not.toContain("ovh-vps = mkConfiguredStableSystem");
		expect(flake).not.toContain("ovh-base = mkConfiguredStableSystem");
		expect(flake).not.toContain("./core/os/pkgs/plain-host-deploy");
		expect(flake).not.toContain("./core/os/disko/ovh-single-disk.nix");
		expect(flake).not.toContain("./core/os/hosts/ovh-base.nix");
		expect(existsSync(rebuildPullScriptPath)).toBe(false);
		expect(existsSync(rebuildPullPackagePath)).toBe(false);
		expect(existsSync(reinstallOvhScriptPath)).toBe(false);
		expect(existsSync(reinstallOvhPackagePath)).toBe(false);
		expect(existsSync(ovhBaseHostPath)).toBe(false);
		expect(existsSync(ovhVpsHostPath)).toBe(false);
		expect(existsSync(reinstallOvhTestPath)).toBe(false);
		expect(existsSync(ovhVpsConfigTestPath)).toBe(false);
		expect(existsSync(ovhBaseConfigTestPath)).toBe(false);
	});

	it("documents and wires a shell-first operator runtime", () => {
		const shellModule = readUtf8(shellModulePath);
		const moduleSets = readUtf8(moduleSetsPath);
		const vpsHost = readUtf8(path.join(repoRoot, "core/os/hosts/vps.nix"));
		const readme = readUtf8(readmePath);
		const runtimeFlows = readUtf8(runtimeFlowsPath);
		const daemonArchitecture = readUtf8(daemonArchitecturePath);
		const serviceArchitecture = readUtf8(serviceArchitecturePath);

		expect(existsSync(shellModulePath)).toBe(true);
		expect(moduleSets).toContain("./shell.nix");
		expect(vpsHost).toContain("bootstrap.enable = lib.mkDefault true;");
		expect(readme).toContain("plain shell runtime");
		expect(shellModule).toContain(`export PATH="\${nodeBinDir}:$PATH"`);
		expect(runtimeFlows).toContain("Interactive operator sessions stay in a plain shell.");
		expect(daemonArchitecture).toContain("interactive login shells stay in a plain shell");
		expect(serviceArchitecture).toContain("plain shell runtime");
	});
});
