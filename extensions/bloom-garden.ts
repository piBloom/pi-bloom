import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ExtensionAPI, truncateHead } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

function getGardenDir(): string {
	return process.env.BLOOM_GARDEN_DIR ?? path.join(os.homedir(), "Garden");
}

function getPackageDir(): string {
	return path.join(fileURLToPath(import.meta.url), "../..");
}

function getPackageVersion(packageDir: string): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf-8"));
		return (pkg.version as string) ?? "0.1.0";
	} catch {
		return "0.1.0";
	}
}

const GARDEN_DIRS = [
	"Inbox",
	"Journal",
	"Projects",
	"Areas",
	"Resources",
	"Archive",
	"Bloom/Persona",
	"Bloom/Skills",
	"Bloom/Evolutions",
];

const PERSONA_FILES = ["SOUL.md", "BODY.md", "FACULTY.md", "SKILL.md"];

interface BlueprintVersions {
	packageVersion: string;
	seeded: Record<string, string>;
	updatesAvailable: Record<string, string>;
}

function readBlueprintVersions(gardenDir: string): BlueprintVersions {
	const fp = path.join(gardenDir, "Bloom", "blueprint-versions.json");
	try {
		return JSON.parse(fs.readFileSync(fp, "utf-8")) as BlueprintVersions;
	} catch {
		return { packageVersion: "0.0.0", seeded: {}, updatesAvailable: {} };
	}
}

function writeBlueprintVersions(gardenDir: string, versions: BlueprintVersions): void {
	fs.writeFileSync(path.join(gardenDir, "Bloom", "blueprint-versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
}

function ensureGarden(gardenDir: string): void {
	for (const dir of GARDEN_DIRS) {
		fs.mkdirSync(path.join(gardenDir, dir), { recursive: true });
	}
	const stignore = path.join(gardenDir, ".stignore");
	if (!fs.existsSync(stignore)) {
		fs.writeFileSync(stignore, "// Syncthing ignore patterns for Garden vault\n");
	}
}

function seedFile(src: string, dest: string, key: string, version: string, versions: BlueprintVersions): void {
	if (!fs.existsSync(src)) return;

	if (!fs.existsSync(dest)) {
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(src, dest);
		versions.seeded[key] = version;
		return;
	}

	const seededVersion = versions.seeded[key];
	if (!seededVersion || seededVersion === version) return;

	const srcContent = fs.readFileSync(src, "utf-8");
	const destContent = fs.readFileSync(dest, "utf-8");

	if (srcContent === destContent) {
		versions.seeded[key] = version;
	} else {
		versions.updatesAvailable[key] = version;
	}
}

function seedBlueprints(gardenDir: string, packageDir: string): void {
	const version = getPackageVersion(packageDir);
	const versions = readBlueprintVersions(gardenDir);

	for (const file of PERSONA_FILES) {
		const key = `persona/${file}`;
		const src = path.join(packageDir, "persona", file);
		const dest = path.join(gardenDir, "Bloom", "Persona", file);
		seedFile(src, dest, key, version, versions);
	}

	const skillsDir = path.join(packageDir, "skills");
	if (fs.existsSync(skillsDir)) {
		for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const key = `skills/${entry.name}/SKILL.md`;
			const src = path.join(skillsDir, entry.name, "SKILL.md");
			const dest = path.join(gardenDir, "Bloom", "Skills", entry.name, "SKILL.md");
			seedFile(src, dest, key, version, versions);
		}
	}

	versions.packageVersion = version;
	writeBlueprintVersions(gardenDir, versions);
}

function countFiles(dir: string): number {
	let count = 0;
	if (!fs.existsSync(dir)) return 0;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			count += countFiles(path.join(dir, entry.name));
		} else if (entry.name.endsWith(".md")) {
			count++;
		}
	}
	return count;
}

export default function (pi: ExtensionAPI) {
	const gardenDir = getGardenDir();
	const packageDir = getPackageDir();

	pi.on("session_start", (_event, ctx) => {
		ensureGarden(gardenDir);
		seedBlueprints(gardenDir, packageDir);
		process.env._BLOOM_GARDEN_RESOLVED = gardenDir;

		const versions = readBlueprintVersions(gardenDir);
		const updates = Object.keys(versions.updatesAvailable);
		if (ctx.hasUI) {
			if (updates.length > 0) {
				ctx.ui.setWidget("bloom-updates", [
					`${updates.length} blueprint update(s) available — /garden update-blueprints`,
				]);
			}
			ctx.ui.setStatus("bloom-garden", `Garden: ${gardenDir}`);
		}
	});

	pi.registerTool({
		name: "garden_status",
		label: "Garden Status",
		description: "Show Garden vault location, file counts, and blueprint state",
		promptSnippet: "Show Garden vault status and blueprint state",
		promptGuidelines: ["Use garden_status to check the Garden vault state."],
		parameters: Type.Object({}),
		async execute() {
			const lines: string[] = [`Garden: ${gardenDir}`, ""];

			for (const dir of ["Inbox", "Journal", "Projects", "Areas", "Resources", "Archive"]) {
				lines.push(`${dir}: ${countFiles(path.join(gardenDir, dir))} files`);
			}

			const versions = readBlueprintVersions(gardenDir);
			lines.push("", `Package version: ${versions.packageVersion}`);
			lines.push(`Seeded blueprints: ${Object.keys(versions.seeded).length}`);

			const updates = Object.keys(versions.updatesAvailable);
			if (updates.length > 0) {
				lines.push(`Updates available: ${updates.join(", ")}`);
			}

			return {
				content: [
					{ type: "text" as const, text: truncateHead(lines.join("\n"), { maxLines: 2000, maxBytes: 50000 }).content },
				],
				details: {},
			};
		},
	});

	pi.registerCommand("garden", {
		description: "Garden vault management: /garden init | status | update-blueprints",
		handler: async (args: string, ctx) => {
			const sub = args.trim().split(/\s+/)[0] ?? "";

			switch (sub) {
				case "init": {
					ensureGarden(gardenDir);
					seedBlueprints(gardenDir, packageDir);
					ctx.ui.notify("Garden initialized", "info");
					break;
				}
				case "status": {
					pi.sendUserMessage("Show garden status using the garden_status tool.", { deliverAs: "followUp" });
					break;
				}
				case "update-blueprints": {
					const versions = readBlueprintVersions(gardenDir);
					const updates = Object.entries(versions.updatesAvailable);
					if (updates.length === 0) {
						ctx.ui.notify("All blueprints are up to date", "info");
						break;
					}
					for (const [key, version] of updates) {
						const src = path.join(packageDir, key);
						const destKey = key.replace(/^persona\//, "Bloom/Persona/").replace(/^skills\//, "Bloom/Skills/");
						const dest = path.join(gardenDir, destKey);
						if (fs.existsSync(src)) {
							fs.copyFileSync(src, dest);
							versions.seeded[key] = version;
						}
					}
					versions.updatesAvailable = {};
					writeBlueprintVersions(gardenDir, versions);
					ctx.ui.notify(`Updated ${updates.length} blueprint(s)`, "info");
					break;
				}
				default: {
					ctx.ui.notify("Usage: /garden init | status | update-blueprints", "info");
					break;
				}
			}
		},
	});
}
