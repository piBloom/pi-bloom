import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const packageJsonPath = path.join(repoRoot, "package.json");
const rebuildPullScriptPath = path.join(repoRoot, "core/scripts/nixpi-rebuild-pull.sh");
const brokerModulePath = path.join(repoRoot, "core/os/modules/broker.nix");
const setupApplyScriptPath = path.join(repoRoot, "core/scripts/nixpi-setup-apply.sh");
const deployOvhScriptPath = path.join(repoRoot, "core/scripts/nixpi-deploy-ovh.sh");
const installFinalizeScriptPath = path.join(repoRoot, "core/scripts/nixpi-install-finalize.sh");
const ovhHostPath = path.join(repoRoot, "core/os/hosts/ovh-vps.nix");
const ovhDiskoPath = path.join(repoRoot, "core/os/disko/ovh-single-disk.nix");
const ovhDeployDocPath = path.join(repoRoot, "docs/operations/ovh-rescue-deploy.md");
const selfEvolutionSkillPath = path.join(repoRoot, "core/pi/skills/self-evolution/SKILL.md");
const appModulePath = path.join(repoRoot, "core/os/modules/app.nix");
const piPackagePath = path.join(repoRoot, "core/os/pkgs/pi/default.nix");

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
		expect(appModule).toContain("chown -R");
		expect(appModule).toContain("/srv/nixpi");
	});

	it("documents the canonical /srv/nixpi rebuild workflow and pull wrapper", () => {
		const rebuildPullScript = readFileSync(rebuildPullScriptPath, "utf8");
		const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
		const installFinalizeScript = readFileSync(installFinalizeScriptPath, "utf8");
		const osActions = readFileSync(path.join(repoRoot, "core/pi/extensions/os/actions.ts"), "utf8");
		const selfEvolutionSkill = readFileSync(selfEvolutionSkillPath, "utf8");

		expect(rebuildPullScript).toContain('REPO_DIR="/srv/nixpi"');
		expect(rebuildPullScript).toContain('TARGET_REF="' + "$" + '{1:-main}"');
		expect(rebuildPullScript).toContain('git -C "$REPO_DIR" fetch origin');
		expect(rebuildPullScript).toContain('git -C "$REPO_DIR" reset --hard "origin/$TARGET_REF"');
		expect(rebuildPullScript).toContain("exec nixos-rebuild switch --flake /etc/nixos#nixos --impure");

		expect(readme).toContain("/srv/nixpi");
		expect(readme).toContain("nixpi-rebuild-pull");

		expect(installFinalizeScript).toContain('REPO_DIR="/srv/nixpi"');
		expect(installFinalizeScript).toContain('git clone --branch "$REPO_BRANCH" "$REPO_URL" "$REPO_DIR"');
		expect(installFinalizeScript).toContain('chown -R "$PRIMARY_USER:$primary_group" "$REPO_DIR"');
		expect(installFinalizeScript).toContain("nixpi-init-system-flake.sh");

		expect(osActions).toContain("/srv/nixpi");
		expect(osActions).toContain("nixpi-rebuild-pull");

		expect(selfEvolutionSkill).toContain("/srv/nixpi");
		expect(selfEvolutionSkill).toContain("nixpi-rebuild-pull");
	});

	it("keeps direct sudo temporary during setup and removes it after completion", () => {
		const brokerModule = readFileSync(brokerModulePath, "utf8");
		const setupApplyScript = readFileSync(setupApplyScriptPath, "utf8");

		expect(brokerModule).toContain('firstBootSudoersDir = "${' + 'stateDir}/sudoers.d";');
		expect(brokerModule).toContain('firstBootSudoersPath = "${' + 'firstBootSudoersDir}/nixpi-first-boot";');
		expect(brokerModule).toContain("#includedir ${" + "firstBootSudoersDir}");
		expect(brokerModule).toContain("NOPASSWD: ALL");
		expect(brokerModule).toContain("wizard-state/system-ready");
		expect(setupApplyScript).toContain('FIRST_BOOT_SUDOERS_FILE="/var/lib/nixpi/sudoers.d/nixpi-first-boot"');
		expect(setupApplyScript).toMatch(/rm -f "\$\{FIRST_BOOT_SUDOERS_FILE\}"/);
	});

	it("keeps the OVH deployment lane wired into the repo", () => {
		const flake = readFileSync(path.join(repoRoot, "flake.nix"), "utf8");
		const installDoc = readFileSync(path.join(repoRoot, "docs/install.md"), "utf8");
		const quickDeployDoc = readFileSync(path.join(repoRoot, "docs/operations/quick-deploy.md"), "utf8");

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

	it("keeps headless VPS deployment as the only supported install story", () => {
		const flake = readFileSync(path.join(repoRoot, "flake.nix"), "utf8");
		const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
		const installDoc = readFileSync(path.join(repoRoot, "docs/install.md"), "utf8");
		const quickDeployDoc = readFileSync(path.join(repoRoot, "docs/operations/quick-deploy.md"), "utf8");
		const liveTestingDoc = readFileSync(path.join(repoRoot, "docs/operations/live-testing.md"), "utf8");

		expect(flake).toContain('nixos-anywhere.url = "github:nix-community/nixos-anywhere"');
		expect(flake).toContain("ovh-vps = mkConfiguredStableSystem");
		expect(flake).toContain("nixpi-deploy-ovh");

		expect(readme).toContain("nix run .#nixpi-deploy-ovh --");
		expect(readme).toContain("/srv/nixpi");

		expect(installDoc).toContain("headless VPS");
		expect(installDoc).toContain("nixos-anywhere");
		expect(installDoc).toContain("OVH Rescue Deploy");

		expect(quickDeployDoc).toContain("nixos-anywhere");
		expect(quickDeployDoc).toContain("/srv/nixpi");

		expect(liveTestingDoc).toContain("nixpi-deploy-ovh");
		expect(liveTestingDoc).toContain("/srv/nixpi");
	});
});
