import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const packageJsonPath = path.join(repoRoot, "package.json");
const deployOvhScriptPath = path.join(repoRoot, "core/scripts/nixpi-deploy-ovh.sh");
const deployOvhTestPath = path.join(repoRoot, "tests/integration/nixpi-deploy-ovh.test.ts");
const ovhHostPath = path.join(repoRoot, "core/os/hosts/ovh-vps.nix");
const ovhDiskoPath = path.join(repoRoot, "core/os/disko/ovh-single-disk.nix");
const ovhDeployDocPath = path.join(repoRoot, "docs/operations/ovh-rescue-deploy.md");
const appModulePath = path.join(repoRoot, "core/os/modules/app.nix");
const piPackagePath = path.join(repoRoot, "core/os/pkgs/pi/default.nix");
const terminalUiOptionPath = path.join(repoRoot, "core/os/modules/options/terminal-ui.nix");
const terminalUiModulePath = path.join(repoRoot, "core/os/modules/terminal-ui.nix");
const shellModulePath = path.join(repoRoot, "core/os/modules/shell.nix");
const moduleSetsPath = path.join(repoRoot, "core/os/modules/module-sets.nix");
const runtimeFlowsPath = path.join(repoRoot, "docs/architecture/runtime-flows.md");
const daemonArchitecturePath = path.join(repoRoot, "docs/reference/daemon-architecture.md");
const serviceArchitecturePath = path.join(repoRoot, "docs/reference/service-architecture.md");
const personaSkillPath = path.join(repoRoot, "core/pi/persona/SKILL.md");
const readmePath = path.join(repoRoot, "README.md");
const installDocPath = path.join(repoRoot, "docs/install.md");
const quickDeployDocPath = path.join(repoRoot, "docs/operations/quick-deploy.md");
const firstBootDocPath = path.join(repoRoot, "docs/operations/first-boot-setup.md");
const runtimeFlowsDocPath = path.join(repoRoot, "docs/architecture/runtime-flows.md");
const liveTestingDocPath = path.join(repoRoot, "docs/operations/live-testing.md");
const infrastructureDocPath = path.join(repoRoot, "docs/reference/infrastructure.md");
const productionGuidancePaths = [
	readmePath,
	installDocPath,
	quickDeployDocPath,
	firstBootDocPath,
	runtimeFlowsDocPath,
	liveTestingDocPath,
];

const readDocs = () =>
	Object.fromEntries(productionGuidancePaths.map((filePath) => [filePath, readFileSync(filePath, "utf8")])) as Record<
		string,
		string
	>;

describe("repo standards guards", () => {
	it("configures VitePress for GitHub Project Pages", () => {
		const vitePressConfig = readFileSync(path.join(repoRoot, "docs/.vitepress/config.ts"), "utf8");

		expect(vitePressConfig).toContain('base: "/NixPI/"');
	});

	it("declares compatible Pi peer dependency ranges and CI checks", () => {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
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
		const piPackage = readFileSync(piPackagePath, "utf8");
		const appModule = readFileSync(appModulePath, "utf8");
		expect(piPackage).toContain("makeBinPath [ bash fd ripgrep ]");
		expect(appModule).toContain("pkgs.bash");
		expect(appModule).toContain("shellPath =");
		expect(appModule).toContain("/bin/bash");
		expect(appModule).toContain("systemd.tmpfiles.settings.nixpi-app");
		expect(appModule).toContain("systemd-tmpfiles");
	});

	it("documents the declarative install target and separates rebuilds from repo semantics", () => {
		const docs = readDocs();
		const readme = docs[readmePath];
		const installDoc = docs[installDocPath];
		const quickDeployDoc = docs[quickDeployDocPath];
		const firstBootDoc = docs[firstBootDocPath];
		const runtimeFlowsDoc = docs[runtimeFlowsDocPath];
		const liveTestingDoc = docs[liveTestingDocPath];
		const infrastructureDoc = readFileSync(infrastructureDocPath, "utf8");
		const personaSkill = readFileSync(personaSkillPath, "utf8");

		expect(readme).toContain("nixos-anywhere");
		expect(readme).toContain("final host configuration");
		expect(readme).toContain("optional operator checkout");
		expect(readme).toContain("/srv/nixpi");
		expect(readme).toContain("installed `/etc/nixos` flake is the running host's source of truth");
		expect(readme).toContain("sudo nixpi-rebuild");
		expect(readme).toContain("sudo nixpi-rebuild-pull");

		expect(installDoc).toContain("final host configuration directly");
		expect(installDoc).toContain("No first-boot repo clone or generated flake step");
		expect(installDoc).toContain("Bootstrap and steady-state behavior belongs in NixOS config");
		expect(installDoc).toContain("conventional operator checkout path");
		expect(installDoc).toContain("installed `/etc/nixos` flake remains the source of truth");
		expect(installDoc).toContain("sudo nixpi-rebuild");
		expect(installDoc).toContain("sudo nixpi-rebuild-pull [branch]");

		expect(quickDeployDoc).toContain("installs the final `ovh-vps` host configuration directly");
		expect(quickDeployDoc).toContain("No first-boot repo clone or generated flake step is required");
		expect(quickDeployDoc).toContain("repo checkout such as `/srv/nixpi` is optional");
		expect(quickDeployDoc).toContain("sudo nixpi-rebuild");
		expect(quickDeployDoc).toContain("sudo nixpi-rebuild-pull [branch]");
		expect(quickDeployDoc).toContain("remote branch");
		expect(quickDeployDoc).toContain("syncs the conventional `/srv/nixpi` checkout");

		expect(firstBootDoc).toContain("bootstrap versus steady-state mode from the deployed NixOS config");
		expect(firstBootDoc).toContain("Optional: Verify the Operator Rebuild Path");
		expect(firstBootDoc).toContain("sudo nixpi-rebuild");
		expect(firstBootDoc).toContain("sudo nixpi-rebuild-pull [branch]");
		expect(firstBootDoc).toContain("remote branch");
		expect(firstBootDoc).toContain("lives outside `/srv/nixpi` or alongside it");
		expect(firstBootDoc).toContain("user-home marker files");
		expect(firstBootDoc).toContain("Shell behavior should already match the deployed NixOS configuration");
		expect(firstBootDoc).toContain("installed `/etc/nixos` flake remains authoritative");

		expect(runtimeFlowsDoc).toContain("Install-Time Handoff");
		expect(runtimeFlowsDoc).toContain("Runtime Entry Flow");
		expect(runtimeFlowsDoc).toContain("No boot-time repo clone or generated host flake step");
		expect(runtimeFlowsDoc).toContain("Bootstrap and steady-state are selected declaratively");
		expect(runtimeFlowsDoc).toContain("operator checkout such as `/srv/nixpi` is optional");

		expect(liveTestingDoc).toContain("optional operator checkout workflow");
		expect(liveTestingDoc).toContain("final `ovh-vps` host configuration directly");
		expect(liveTestingDoc).toContain("without first-boot repo seeding or runtime host-flake generation");
		expect(liveTestingDoc).toContain("Optional operator checkouts such as `/srv/nixpi`");

		expect(infrastructureDoc).toContain("installed `/etc/nixos` flake");
		expect(infrastructureDoc).toContain("sudo nixpi-rebuild");
		expect(infrastructureDoc).toContain("sudo nixpi-rebuild-pull [branch]");

		expect(personaSkill).toContain("sudo nixpi-rebuild-pull [branch]");
		expect(personaSkill).not.toContain("branch-or-ref");
	});

	it("keeps production guidance free of imperative first-boot convergence steps", () => {
		const productionGuidance = Object.values(readDocs()).join("\n");

		expect(productionGuidance).not.toContain("let first boot seed `/srv/nixpi` and `/etc/nixos/flake.nix`");
		expect(productionGuidance).not.toContain("a generated `/etc/nixos/flake.nix`");
		expect(productionGuidance).not.toContain("system-ready");
		expect(productionGuidance).not.toContain(".bashrc");
		expect(productionGuidance).not.toContain(".bash_profile");
	});

	it("keeps the OVH deployment lane wired into the repo", () => {
		const flake = readFileSync(path.join(repoRoot, "flake.nix"), "utf8");
		const installDoc = readFileSync(installDocPath, "utf8");
		const quickDeployDoc = readFileSync(quickDeployDocPath, "utf8");
		const readme = readFileSync(readmePath, "utf8");

		expect(flake).toContain('disko.url = "github:nix-community/disko"');
		expect(flake).toContain('nixos-anywhere.url = "github:nix-community/nixos-anywhere"');
		expect(flake).toContain("ovh-vps = mkConfiguredStableSystem");
		expect(flake).toContain("./core/os/hosts/ovh-vps.nix");
		expect(flake).toContain("./core/os/disko/ovh-single-disk.nix");
		expect(flake).toContain("nixpi-deploy-ovh");

		expect(existsSync(ovhHostPath)).toBe(true);
		expect(existsSync(ovhDiskoPath)).toBe(true);
		expect(existsSync(deployOvhScriptPath)).toBe(true);
		expect(existsSync(ovhDeployDocPath)).toBe(true);

		expect(readme).toContain("nix run .#nixpi-deploy-ovh --");
		expect(installDoc).toContain("OVH Rescue Deploy");
		expect(quickDeployDoc).toContain("nixpi-deploy-ovh");
	});

	it("documents an explicit destructive OVH deploy script contract", () => {
		const flake = readFileSync(path.join(repoRoot, "flake.nix"), "utf8");
		const deployScript = readFileSync(deployOvhScriptPath, "utf8");
		const deployDoc = readFileSync(ovhDeployDocPath, "utf8");

		expect(deployScript).toContain("Destructive fresh install for an OVH VPS in rescue mode.");
		expect(deployScript).toContain("--target-host");
		expect(deployScript).toContain("--disk");
		expect(deployScript).toContain("--flake");
		expect(flake).toContain("nixos-anywhere.packages.${" + "system}.nixos-anywhere");

		expect(deployDoc).toContain("rescue mode");
		expect(deployDoc).toContain("nix run .#nixpi-deploy-ovh --");
		expect(deployDoc).toContain("--target-host");
		expect(deployDoc).toContain("--disk");
		expect(deployDoc).toContain("destructive");
		expect(deployDoc).toContain("ssh-keygen -R");
		expect(deployDoc).toContain("/srv/nixpi");
	});

	it("keeps deterministic regression tests for the OVH deploy wrapper", () => {
		const deployScript = readFileSync(deployOvhScriptPath, "utf8");

		expect(existsSync(deployOvhTestPath)).toBe(true);
		expect(deployScript).toContain("build_deploy_flake()");
		expect(deployScript).toContain(`if [[ "\${BASH_SOURCE[0]}" == "$0" ]]; then`);
	});

	it("defines the OVH root partition with size syntax that disko can realize on real disks", () => {
		const ovhDisko = readFileSync(ovhDiskoPath, "utf8");

		expect(ovhDisko).toContain('size = "100%"');
		expect(ovhDisko).not.toContain('end = "100%"');
	});

	it("supports a single bootstrap user with a hashed first-login password for OVH installs", () => {
		const deployScript = readFileSync(deployOvhScriptPath, "utf8");
		const deployDoc = readFileSync(ovhDeployDocPath, "utf8");

		expect(deployScript).toContain("--bootstrap-user");
		expect(deployScript).toContain("--bootstrap-password-hash");
		expect(deployScript).toContain("nixpi.primaryUser = lib.mkForce");
		expect(deployScript).toContain("initialHashedPassword");
		expect(deployDoc).toContain("bootstrap user");
		expect(deployDoc).toContain("bootstrap password hash");
		expect(deployDoc).toContain("initialHashedPassword");
	});

	it("documents the staged OVH kexec troubleshooting flow for disk renumbering", () => {
		const deployDoc = readFileSync(ovhDeployDocPath, "utf8");
		const quickDeployDoc = readFileSync(quickDeployDocPath, "utf8");
		const liveTestingDoc = readFileSync(liveTestingDocPath, "utf8");

		expect(deployDoc).toContain("device names can change after");
		expect(deployDoc).toContain("--phases kexec");
		expect(deployDoc).toContain("rescue passwords do not carry over");
		expect(deployDoc).toContain("authorized_keys");
		expect(deployDoc).toContain("/dev/disk/by-id");
		expect(deployDoc).toContain("--phases disko,install,reboot");

		expect(quickDeployDoc).toContain("No space left on device");
		expect(quickDeployDoc).toContain("temporary installer");
		expect(quickDeployDoc).toContain("/dev/disk/by-id");

		expect(liveTestingDoc).toContain("/dev/disk/by-id");
		expect(liveTestingDoc).toContain("installer-side target disk ID");
	});

	it("keeps headless VPS deployment as the documented install story", () => {
		const flake = readFileSync(path.join(repoRoot, "flake.nix"), "utf8");
		const readme = readFileSync(readmePath, "utf8");
		const installDoc = readFileSync(installDocPath, "utf8");
		const quickDeployDoc = readFileSync(quickDeployDocPath, "utf8");
		const liveTestingDoc = readFileSync(path.join(repoRoot, "docs/operations/live-testing.md"), "utf8");

		expect(flake).toContain('nixos-anywhere.url = "github:nix-community/nixos-anywhere"');
		expect(flake).toContain("ovh-vps = mkConfiguredStableSystem");
		expect(flake).toContain("nixpi-deploy-ovh");

		expect(readme).toContain("headless");
		expect(readme).toContain("nixos-anywhere");
		expect(readme).toContain("/srv/nixpi");

		expect(installDoc).toContain("headless VPS");
		expect(installDoc).toContain("nixos-anywhere");
		expect(installDoc).toContain("OVH Rescue Deploy");

		expect(quickDeployDoc).toContain("nixos-anywhere");
		expect(quickDeployDoc).toContain("/srv/nixpi");

		expect(liveTestingDoc).toContain("nixpi-deploy-ovh");
		expect(liveTestingDoc).toContain("/srv/nixpi");
	});
	it("wires a declarative Zellij terminal UI as the default operator interface", () => {
		expect(existsSync(terminalUiOptionPath)).toBe(true);
		expect(existsSync(terminalUiModulePath)).toBe(true);

		const terminalOptions = readFileSync(terminalUiOptionPath, "utf8");
		const terminalModule = readFileSync(terminalUiModulePath, "utf8");
		const shellModule = readFileSync(shellModulePath, "utf8");
		const moduleSets = readFileSync(moduleSetsPath, "utf8");
		const vpsHost = readFileSync(path.join(repoRoot, "core/os/hosts/vps.nix"), "utf8");
		const runtimeFlows = readFileSync(runtimeFlowsPath, "utf8");
		const daemonArchitecture = readFileSync(daemonArchitecturePath, "utf8");
		const serviceArchitecture = readFileSync(serviceArchitecturePath, "utf8");

		expect(terminalOptions).toContain("options.nixpi.terminal");
		expect(terminalOptions).toContain('"plain-shell"');
		expect(terminalOptions).toContain('"zellij"');
		expect(terminalOptions).toContain('"nixpkgs"');

		expect(terminalModule).toContain("nixpi-launch-terminal-ui");
		expect(terminalModule).toContain("NIXPI_NO_ZELLIJ");
		expect(terminalModule).toContain("config.kdl");
		expect(terminalModule).toContain('pane command="pi"');
		expect(terminalModule).toContain("attachExistingSession");

		expect(shellModule).toContain("nixpi-launch-terminal-ui");
		expect(moduleSets).toContain("./terminal-ui.nix");
		expect(vpsHost).toContain('terminal.interface = lib.mkDefault "zellij";');
		expect(vpsHost).toContain("terminal.zellij.enable = lib.mkDefault true;");

		expect(runtimeFlows).toContain("Zellij");
		expect(runtimeFlows).toContain("NIXPI_NO_ZELLIJ=1");
		expect(daemonArchitecture).toContain("Zellij");
		expect(daemonArchitecture).toContain("NIXPI_NO_ZELLIJ=1");
		expect(serviceArchitecture).toContain("Zellij");
		expect(serviceArchitecture).toContain("NIXPI_NO_ZELLIJ=1");
	});
});
