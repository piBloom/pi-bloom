/**
 * Scaffold handler for bloom-services — generates new service packages.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import jsYaml from "js-yaml";
import type { ServiceCatalogEntry } from "../../lib/services-catalog.js";
import { validatePinnedImage, validateServiceName } from "../../lib/services-validation.js";
import { errorResult } from "../../lib/shared.js";

/** Walk up from ctx.cwd to find the repo dir containing services/ and package.json. */
function resolveRepoDir(ctx: ExtensionContext): string {
	let current = ctx.cwd;
	for (let i = 0; i < 6; i++) {
		if (existsSync(join(current, "services")) && existsSync(join(current, "package.json"))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	const preferred = join(os.homedir(), ".bloom", "pi-bloom");
	if (existsSync(join(preferred, "services"))) return preferred;
	return ctx.cwd;
}

export async function handleScaffold(
	params: {
		name: string;
		description: string;
		image: string;
		version?: string;
		category?: string;
		optional?: boolean;
		port?: number;
		container_port?: number;
		web_service?: boolean;
		title?: string;
		icon_text?: string;
		path_hint?: string;
		access_path?: string;
		network?: string;
		memory?: string;
		socket_activated?: boolean;
		overwrite?: boolean;
	},
	ctx: ExtensionContext,
) {
	const guard = validateServiceName(params.name);
	if (guard) return errorResult(guard);
	const imageGuard = validatePinnedImage(params.image);
	if (imageGuard) return errorResult(imageGuard);
	const isWebService = params.web_service ?? Boolean(params.port);
	if (isWebService && !params.port) {
		return errorResult("web_service=true requires port so Bloom Home can generate an access URL.");
	}

	const scaffoldRepoDir = resolveRepoDir(ctx);
	const serviceDir = join(scaffoldRepoDir, "services", params.name);
	const quadletDir = join(serviceDir, "quadlet");
	const skillPath = join(serviceDir, "SKILL.md");
	const containerPath = join(quadletDir, `bloom-${params.name}.container`);
	const socketPath = join(quadletDir, `bloom-${params.name}.socket`);

	const overwrite = params.overwrite ?? false;
	const existingError = ensureScaffoldTargetAvailable(serviceDir, overwrite);
	if (existingError) return existingError;

	mkdirSync(quadletDir, { recursive: true });
	const scaffoldDefaults = {
		version: params.version ?? "0.1.0",
		network: params.network ?? "host",
		memory: params.memory ?? "256m",
		enableSocket: params.socket_activated ?? false,
	};
	writeFileSync(
		containerPath,
		buildContainerUnit(params, scaffoldDefaults.network, scaffoldDefaults.memory, scaffoldDefaults.enableSocket),
	);
	if (scaffoldDefaults.enableSocket && params.port) {
		writeFileSync(socketPath, buildSocketUnit(params.name, params.port));
	}
	writeFileSync(skillPath, buildSkillTemplate(params.name, params.description, params.image, scaffoldDefaults.version));
	writeCatalogEntry(scaffoldRepoDir, params, scaffoldDefaults.version, isWebService);

	const created = [containerPath, skillPath];
	if (existsSync(socketPath)) created.push(socketPath);
	created.push(join(scaffoldRepoDir, "services", "catalog.yaml"));

	return {
		content: [{ type: "text" as const, text: `Service scaffold created:\n${created.map((f) => `- ${f}`).join("\n")}` }],
		details: {
			repoDir: scaffoldRepoDir,
			service: params.name,
			category: params.category ?? null,
			files: created,
		},
	};
}

function ensureScaffoldTargetAvailable(serviceDir: string, overwrite: boolean) {
	return existsSync(serviceDir) && !overwrite
		? errorResult(`Service directory already exists: ${serviceDir}. Use overwrite=true to replace files.`)
		: null;
}

function buildContainerUnit(
	params: { name: string; description: string; image: string; port?: number; container_port?: number },
	network: string,
	memory: string,
	enableSocket: boolean,
) {
	const maybeSocketArgs = enableSocket ? "PodmanArgs=--preserve-fds=1\n" : "";
	const publishPort =
		params.port && params.container_port && network !== "host"
			? `PublishPort=${Math.round(params.port)}:${Math.round(params.container_port)}\n`
			: "";
	const installBlock = enableSocket ? "" : "\n[Install]\nWantedBy=default.target\n";
	return `[Unit]\nDescription=Bloom ${params.name} — ${params.description}\nAfter=network-online.target\nWants=network-online.target\n${enableSocket ? "StopWhenUnneeded=true\n" : ""}\n[Container]\nImage=${params.image}\nContainerName=bloom-${params.name}\nNetwork=${network}\n${publishPort}${maybeSocketArgs}PodmanArgs=--memory=${memory}\nNoNewPrivileges=true\nLogDriver=journald\n\n[Service]\nRestart=on-failure\nRestartSec=10\nTimeoutStartSec=300\n${installBlock}`;
}

function buildSocketUnit(name: string, port: number) {
	return `[Unit]\nDescription=Bloom ${name} — Socket activation listener\n\n[Socket]\nListenStream=${Math.round(port)}\nAccept=no\nService=bloom-${name}.service\nSocketMode=0660\n\n[Install]\nWantedBy=sockets.target\n`;
}

function buildSkillTemplate(name: string, description: string, image: string, version: string) {
	return `---\nname: ${name}\nversion: ${version}\ndescription: ${description}\nimage: ${image}\n---\n\n# ${name}\n\nDescribe how to use this service.\n\n## API\n\nDocument endpoints, commands, and examples here.\n\n## Operations\n\n- Install: \`systemctl --user start bloom-${name}\`\n- Logs: \`journalctl --user -u bloom-${name} -n 100\`\n`;
}

interface ServiceCatalogFile {
	version?: number;
	source_repo?: string;
	services?: Record<string, ServiceCatalogEntry>;
	bridges?: Record<string, unknown>;
}

function loadCatalog(catalogPath: string): ServiceCatalogFile {
	if (!existsSync(catalogPath)) return { version: 1, services: {} };
	const raw = readFileSync(catalogPath, "utf-8");
	return (jsYaml.load(raw, { schema: jsYaml.JSON_SCHEMA }) as ServiceCatalogFile | null) ?? { version: 1, services: {} };
}

function saveCatalog(catalogPath: string, catalog: ServiceCatalogFile) {
	writeFileSync(catalogPath, jsYaml.dump(catalog, { lineWidth: 120, noRefs: true, sortKeys: false }));
}

function writeCatalogEntry(
	repoDir: string,
	params: {
		name: string;
		description: string;
		image: string;
		category?: string;
		optional?: boolean;
		port?: number;
		title?: string;
		icon_text?: string;
		path_hint?: string;
		access_path?: string;
	},
	version: string,
	isWebService: boolean,
) {
	const catalogPath = join(repoDir, "services", "catalog.yaml");
	const catalog = loadCatalog(catalogPath);
	const services = catalog.services ?? {};
	const current = services[params.name] ?? {};
	const next: ServiceCatalogEntry = {
		...current,
		version,
		category: params.category ?? current.category,
		image: params.image,
		optional: params.optional ?? current.optional ?? true,
		description: params.description,
	};
	if (isWebService) {
		next.home_visible = true;
		next.port = params.port;
		next.title = params.title ?? current.title ?? titleFromName(params.name);
		next.icon_text = params.icon_text ?? current.icon_text;
		next.path_hint = params.path_hint ?? current.path_hint;
		next.access_path = params.access_path ?? current.access_path ?? "/";
	} else {
		delete next.home_visible;
		delete next.port;
		delete next.title;
		delete next.icon_text;
		delete next.path_hint;
		delete next.access_path;
	}
	services[params.name] = next;
	catalog.services = services;
	saveCatalog(catalogPath, catalog);
}

function titleFromName(name: string): string {
	return name
		.split("-")
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(" ");
}
