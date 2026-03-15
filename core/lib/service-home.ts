import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { run } from "./exec.js";
import { getQuadletDir } from "./filesystem.js";
import { type ServiceCatalogEntry, loadServiceCatalog } from "./services-catalog.js";

export interface MeshAccess {
	preferredHost: string;
	fqdn?: string;
	meshIp?: string;
}

export interface ServiceHomeCard {
	name: string;
	title: string;
	description: string;
	iconText: string;
	pathHint?: string;
	status: "running" | "installed";
	url?: string;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function titleFromName(name: string): string {
	return name
		.split("-")
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(" ");
}

function iconTextFor(name: string, entry?: ServiceCatalogEntry): string {
	if (entry?.icon_text?.trim()) return entry.icon_text.trim().slice(0, 3).toUpperCase();
	return name
		.split("-")
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() ?? "")
		.join("")
		.slice(0, 3);
}

function detectInstalledServices(catalog: Record<string, ServiceCatalogEntry>): string[] {
	const quadletDir = getQuadletDir();
	if (!existsSync(quadletDir)) return [];
	return readdirSync(quadletDir)
		.filter((file) => file.startsWith("bloom-") && file.endsWith(".container"))
		.map((file) => file.slice("bloom-".length, -".container".length))
		.filter((name) => Boolean(catalog[name]))
		.sort((a, b) => a.localeCompare(b));
}

async function detectRunningServices(signal?: AbortSignal): Promise<Set<string>> {
	const result = await run("podman", ["ps", "--format", "json", "--filter", "name=bloom-"], signal);
	const running = new Set<string>();
	if (result.exitCode !== 0) return running;
	try {
		const containers = JSON.parse(result.stdout || "[]") as Array<{ Names?: string[] }>;
		for (const container of containers) {
			const name = (container.Names ?? [])[0]?.replace(/^bloom-/, "") ?? "";
			if (name) running.add(name);
		}
	} catch {
		// Ignore parse errors and keep a best-effort installed-only view.
	}
	return running;
}

export async function resolveMeshAccess(signal?: AbortSignal): Promise<MeshAccess> {
	const status = await run("netbird", ["status", "--json"], signal);
	if (status.exitCode === 0) {
		try {
			const parsed = JSON.parse(status.stdout) as { fqdn?: string; netbirdIp?: string };
			const fqdn = parsed.fqdn?.trim();
			const meshIp = parsed.netbirdIp?.split("/")[0]?.trim();
			if (fqdn || meshIp) {
				return {
					preferredHost: fqdn || meshIp || "localhost",
					fqdn: fqdn || undefined,
					meshIp: meshIp || undefined,
				};
			}
		} catch {
			// Fall back below.
		}
	}

	return { preferredHost: "localhost" };
}

export function buildServiceHomeCards(params: {
	catalog: Record<string, ServiceCatalogEntry>;
	installedServices: string[];
	runningServices: Set<string>;
	meshAccess: MeshAccess;
}): ServiceHomeCard[] {
	const { catalog, installedServices, runningServices, meshAccess } = params;
	return installedServices.map((name) => {
		const entry = catalog[name];
		const accessPath = entry?.access_path?.trim() || "/";
		const normalizedAccessPath = accessPath.startsWith("/") ? accessPath : `/${accessPath}`;
		const url =
			entry?.port && meshAccess.preferredHost
				? `http://${meshAccess.preferredHost}:${entry.port}${normalizedAccessPath === "/" ? "" : normalizedAccessPath}`
				: undefined;

		return {
			name,
			title: entry?.title?.trim() || titleFromName(name),
			description: entry?.description?.trim() || "Installed Bloom service",
			iconText: iconTextFor(name, entry),
			pathHint: entry?.path_hint?.trim() || undefined,
			status: runningServices.has(name) ? "running" : "installed",
			url,
		};
	});
}

export function renderServiceHomeHtml(params: {
	meshAccess: MeshAccess;
	cards: ServiceHomeCard[];
	generatedAt?: string;
}): string {
	const generatedAt = params.generatedAt ?? new Date().toISOString();
	const shareTarget = `http://${params.meshAccess.preferredHost}:8080`;
	const alternateTargets = [params.meshAccess.fqdn, params.meshAccess.meshIp]
		.filter(
			(value, index, items): value is string =>
				Boolean(value) && items.indexOf(value) === index && value !== params.meshAccess.preferredHost,
		)
		.map((host) => `http://${host}:8080`);

	const cards = params.cards.length
		? params.cards
				.map((card) => {
					const accessMarkup = card.url
						? `<a class="service-link" href="${escapeHtml(card.url)}">${escapeHtml(card.url)}</a>`
						: `<span class="service-muted">No NetBird route detected yet.</span>`;
					const pathMarkup = card.pathHint
						? `<p class="service-meta"><span class="service-label">Path</span>${escapeHtml(card.pathHint)}</p>`
						: "";
					const statusClass = card.status === "running" ? "status-live" : "status-idle";
					const statusLabel = card.status === "running" ? "Running" : "Installed";

					return `
						<article class="service-card">
							<div class="service-head">
								<div class="service-icon">${escapeHtml(card.iconText)}</div>
								<div>
									<h2>${escapeHtml(card.title)}</h2>
									<p class="service-description">${escapeHtml(card.description)}</p>
								</div>
								<span class="service-status ${statusClass}">${statusLabel}</span>
							</div>
							<p class="service-meta"><span class="service-label">URL</span>${accessMarkup}</p>
							${pathMarkup}
						</article>
					`;
				})
				.join("\n")
		: `<article class="service-card empty-state">
				<h2>No packaged web services installed yet</h2>
				<p class="service-description">Install Cinny, dufs, code-server, or other Bloom services and this page will update itself.</p>
			</article>`;

	const alternateMarkup = alternateTargets.length
		? `<div class="share-secondary">
				<p class="share-note">Alternate hostnames</p>
				${alternateTargets.map((target) => `<code>${escapeHtml(target)}</code>`).join("")}
			</div>`
		: "";

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Bloom Home</title>
	<style>
		:root {
			color-scheme: light;
			--bg: #f4efe4;
			--panel: rgba(255, 252, 245, 0.92);
			--panel-strong: #fffaf0;
			--ink: #1f2a2e;
			--muted: #5f6d68;
			--line: rgba(31, 42, 46, 0.12);
			--accent: #d66b2c;
			--accent-soft: rgba(214, 107, 44, 0.14);
			--live: #2a7a4b;
			--idle: #8a6d3b;
			--shadow: 0 18px 50px rgba(63, 44, 17, 0.12);
			font-family: "IBM Plex Sans", "Avenir Next", sans-serif;
		}

		* { box-sizing: border-box; }

		body {
			margin: 0;
			min-height: 100vh;
			background:
				radial-gradient(circle at top left, rgba(214, 107, 44, 0.2), transparent 28%),
				radial-gradient(circle at top right, rgba(53, 113, 132, 0.16), transparent 24%),
				linear-gradient(180deg, #f8f2e8 0%, var(--bg) 100%);
			color: var(--ink);
		}

		main {
			max-width: 1100px;
			margin: 0 auto;
			padding: 32px 20px 48px;
		}

		.hero,
		.service-card,
		.footer-note {
			background: var(--panel);
			border: 1px solid var(--line);
			border-radius: 24px;
			box-shadow: var(--shadow);
			backdrop-filter: blur(12px);
		}

		.hero {
			padding: 28px;
			margin-bottom: 20px;
		}

		.eyebrow {
			margin: 0 0 10px;
			letter-spacing: 0.14em;
			text-transform: uppercase;
			font-size: 0.75rem;
			color: var(--muted);
		}

		h1 {
			margin: 0;
			font-family: "IBM Plex Serif", Georgia, serif;
			font-size: clamp(2rem, 4vw, 3.5rem);
			line-height: 0.95;
		}

		.hero p {
			max-width: 60ch;
			color: var(--muted);
			font-size: 1rem;
			line-height: 1.55;
		}

		.share-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
			gap: 14px;
			margin-top: 22px;
		}

		.share-card {
			padding: 16px 18px;
			border-radius: 18px;
			background: var(--panel-strong);
			border: 1px solid var(--line);
		}

		.share-card code,
		.share-secondary code {
			display: inline-block;
			margin-top: 8px;
			padding: 9px 12px;
			border-radius: 999px;
			background: #1f2a2e;
			color: #fffaf0;
			font-size: 0.95rem;
		}

		.share-note {
			margin: 0;
			font-size: 0.78rem;
			text-transform: uppercase;
			letter-spacing: 0.08em;
			color: var(--muted);
		}

		.share-secondary {
			display: flex;
			flex-wrap: wrap;
			gap: 10px;
			align-items: center;
			margin-top: 12px;
		}

		.services-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
			gap: 16px;
		}

		.service-card {
			padding: 20px;
		}

		.service-head {
			display: grid;
			grid-template-columns: 62px 1fr auto;
			gap: 14px;
			align-items: start;
			margin-bottom: 18px;
		}

		.service-icon {
			width: 62px;
			height: 62px;
			border-radius: 18px;
			display: grid;
			place-items: center;
			font-weight: 700;
			letter-spacing: 0.08em;
			background: linear-gradient(135deg, var(--accent), #f1b24a);
			color: #fffaf0;
		}

		.service-card h2 {
			margin: 0 0 6px;
			font-size: 1.2rem;
		}

		.service-description,
		.service-meta {
			margin: 0;
			color: var(--muted);
			line-height: 1.5;
		}

		.service-meta {
			display: flex;
			flex-direction: column;
			gap: 6px;
			margin-top: 12px;
		}

		.service-label {
			text-transform: uppercase;
			letter-spacing: 0.08em;
			font-size: 0.76rem;
			color: var(--muted);
		}

		.service-link {
			color: var(--ink);
			text-decoration-thickness: 2px;
			text-underline-offset: 3px;
			word-break: break-all;
		}

		.service-muted {
			color: var(--muted);
		}

		.service-status {
			padding: 8px 10px;
			border-radius: 999px;
			font-size: 0.78rem;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: 0.06em;
		}

		.status-live {
			background: rgba(42, 122, 75, 0.12);
			color: var(--live);
		}

		.status-idle {
			background: rgba(138, 109, 59, 0.14);
			color: var(--idle);
		}

		.empty-state {
			grid-column: 1 / -1;
		}

		.footer-note {
			margin-top: 18px;
			padding: 16px 18px;
			color: var(--muted);
			font-size: 0.92rem;
		}

		@media (max-width: 720px) {
			main { padding: 20px 14px 36px; }
			.hero { padding: 22px; }
			.service-head {
				grid-template-columns: 62px 1fr;
			}
			.service-status {
				grid-column: 1 / -1;
				justify-self: start;
			}
		}
	</style>
</head>
<body>
	<main>
		<section class="hero">
			<p class="eyebrow">Bloom Home</p>
			<h1>Service access for this Bloom node</h1>
			<p>Use this page to remember which NetBird URL to open, which hostname or IP to share with other peers, and which local path each service exposes.</p>
			<div class="share-grid">
				<div class="share-card">
					<p class="share-note">Share this page</p>
					<code>${escapeHtml(shareTarget)}</code>
				</div>
				<div class="share-card">
					<p class="share-note">Preferred host for services</p>
					<code>${escapeHtml(params.meshAccess.preferredHost)}</code>
				</div>
			</div>
			${alternateMarkup}
		</section>
		<section class="services-grid">
			${cards}
		</section>
		<section class="footer-note">
			Generated ${escapeHtml(generatedAt)}. URLs prefer the current NetBird FQDN when available, then fall back to the mesh IP.
		</section>
	</main>
</body>
</html>
`;
}

export async function writeServiceHomeRuntime(
	configDir = join(os.homedir(), ".config", "bloom"),
	repoDir = process.cwd(),
	signal?: AbortSignal,
): Promise<void> {
	const catalog = loadServiceCatalog(repoDir);
	const installedServices = detectInstalledServices(catalog);
	const runningServices = await detectRunningServices(signal);
	const meshAccess = await resolveMeshAccess(signal);
	const cards = buildServiceHomeCards({ catalog, installedServices, runningServices, meshAccess });
	const homeDir = join(configDir, "home");
	mkdirSync(homeDir, { recursive: true });
	writeFileSync(join(homeDir, "index.html"), renderServiceHomeHtml({ meshAccess, cards }));

	const summary = {
		generatedAt: new Date().toISOString(),
		meshAccess,
		services: cards.map((card) => ({
			name: card.name,
			title: card.title,
			status: card.status,
			url: card.url,
			pathHint: card.pathHint,
		})),
	};
	writeFileSync(join(homeDir, "services.json"), JSON.stringify(summary, null, 2));
}
