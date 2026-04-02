import fs from "node:fs";
import path from "node:path";
import { getNixPiDir, safePath } from "../../../lib/filesystem.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../../lib/frontmatter.js";
import { errorResult, nowIso } from "../../../lib/utils.js";
import { defaultObjectBody, mergeObjectState, readMemoryRecord, writeMemoryRecord } from "../objects/memory.js";

export interface PromotionTarget {
	type: string;
	slug: string;
	title?: string;
	summary?: string;
	scope?: string;
	scope_value?: string;
	confidence?: string;
	status?: string;
	salience?: number;
	tags?: string[];
}

export interface EpisodeRecord {
	filepath: string;
	relpath: string;
	attributes: Record<string, unknown>;
	body: string;
}

export function ensureEpisodesDir(): string {
	const dir = path.join(getNixPiDir(), "Episodes");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

export function dayStamp(iso: string): string {
	return iso.slice(0, 10);
}

export function timestampSlug(iso: string): string {
	return iso.replaceAll(":", "-");
}

export function episodeRef(id: string): string {
	return `episode/${id}`;
}

export function createEpisode(params: {
	title: string;
	body: string;
	kind?: string;
	room?: string;
	agent?: string;
	importance?: string;
	tags?: string[];
	derived_objects?: string[];
}) {
	const created = nowIso();
	const id = `${timestampSlug(created)}${params.room ? `-${params.room}` : ""}`;
	const dir = path.join(ensureEpisodesDir(), dayStamp(created));
	let filepath: string;
	try {
		filepath = safePath(dir, `${id}.md`);
	} catch {
		return errorResult("Path traversal blocked: invalid episode id");
	}
	fs.mkdirSync(path.dirname(filepath), { recursive: true });
	const frontmatter = {
		type: "episode",
		id,
		room: params.room ?? null,
		agent: params.agent ?? null,
		kind: params.kind ?? "observation",
		importance: params.importance ?? "medium",
		tags: params.tags ?? [],
		derived_objects: params.derived_objects ?? [],
		created,
		title: params.title,
	};
	try {
		fs.writeFileSync(filepath, stringifyFrontmatter(frontmatter, `# ${params.title}\n\n${params.body}\n`), {
			flag: "wx",
		});
	} catch (err) {
		return errorResult(`failed to create episode: ${(err as Error).message}`);
	}
	return {
		content: [{ type: "text" as const, text: `created episode/${id}` }],
		details: { path: filepath, id, frontmatter },
	};
}

export function listEpisodes(params: { day?: string; kind?: string; limit?: number }) {
	return loadEpisodes(params).map((episode) => episode.relpath);
}

export function loadEpisodes(params: { day?: string; kind?: string; limit?: number }): EpisodeRecord[] {
	const root = ensureEpisodesDir();
	const max = Math.max(1, Math.min(200, Number(params.limit ?? 20)));
	const files = fs.existsSync(root) ? fs.globSync("**/*.md", { cwd: root }).sort().reverse() : [];
	const matches: EpisodeRecord[] = [];
	for (const rel of files) {
		const filepath = path.join(root, rel);
		const raw = fs.readFileSync(filepath, "utf-8");
		const day = rel.split(path.sep)[0] ?? "";
		if (params.day && day !== params.day) continue;
		if (params.kind && !raw.includes(`kind: ${params.kind}`)) continue;
		const parsed = parseFrontmatter<Record<string, unknown>>(raw);
		matches.push({ filepath, relpath: rel, attributes: parsed.attributes, body: parsed.body });
		if (matches.length >= max) break;
	}
	return matches;
}

function findEpisodePath(id: string): string | null {
	const root = ensureEpisodesDir();
	const files = fs.existsSync(root) ? fs.globSync("**/*.md", { cwd: root }) : [];
	for (const rel of files) {
		if (path.basename(rel, ".md") === id) {
			return path.join(root, rel);
		}
	}
	return null;
}

function buildPromotionBody(title: string, sourceBody: string, sourceRef: string): string {
	const trimmed = sourceBody.trim();
	return `${defaultObjectBody({ title }).trimEnd()}\n\nDerived from ${sourceRef}.\n\n${trimmed}\n`.trimStart();
}

function updateEpisodeDerivedObjects(filepath: string, ref: string) {
	const raw = fs.readFileSync(filepath, "utf-8");
	const { attributes, body } = parseFrontmatter<Record<string, unknown>>(raw);
	const derived = Array.isArray(attributes.derived_objects) ? [...(attributes.derived_objects as string[])] : [];
	if (!derived.includes(ref)) {
		derived.push(ref);
		attributes.derived_objects = derived;
		fs.writeFileSync(filepath, stringifyFrontmatter(attributes, body));
	}
}

function episodeStringField(episode: Record<string, unknown>, key: string, fallback: string): string {
	return typeof episode[key] === "string" ? (episode[key] as string) : fallback;
}

function episodeKind(episode: Record<string, unknown>): string {
	return episodeStringField(episode, "kind", "observation");
}

function episodeImportance(episode: Record<string, unknown>): string {
	return episodeStringField(episode, "importance", "medium");
}

function episodeRoom(episode: Record<string, unknown>): string {
	return episodeStringField(episode, "room", "");
}

function episodeTags(episode: Record<string, unknown>): string[] {
	return Array.isArray(episode.tags) ? (episode.tags as string[]) : [];
}

function defaultConfidence(importance: string): string {
	return importance === "high" ? "high" : "medium";
}

function defaultSalience(importance: string): number {
	return importance === "high" ? 0.9 : 0.7;
}

function conservativeDefaults(target: PromotionTarget, episode: Record<string, unknown>): PromotionTarget {
	const kind = episodeKind(episode);
	const importance = episodeImportance(episode);
	const room = episodeRoom(episode);
	return {
		...target,
		scope: target.scope ?? (room ? "room" : "global"),
		scope_value: target.scope_value ?? (room ? room : undefined),
		confidence: target.confidence ?? defaultConfidence(importance),
		status: target.status ?? "active",
		salience: target.salience ?? defaultSalience(importance),
		tags: target.tags ?? episodeTags(episode),
		summary: target.summary ?? (typeof episode.title === "string" ? `${kind}: ${episode.title}` : kind),
	};
}

function normalizeSlug(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

function episodeAlreadyPromoted(attributes: Record<string, unknown>): boolean {
	return Array.isArray(attributes.derived_objects) && attributes.derived_objects.length > 0;
}

function inferPromotionType(kind: string, tags: string[], haystack: string): string | null {
	if (tags.includes("preference") || /\bprefer(s|red)?\b/.test(haystack)) return "preference";
	if (kind === "resolution" || tags.includes("procedure") || /\brestart\b|\bsteps?\b|\bverify\b/.test(haystack)) {
		return "procedure";
	}
	if (kind === "decision-point" || tags.includes("decision") || /\bdecided\b|\bdecision\b|\bchose\b/.test(haystack)) {
		return "decision";
	}
	if (tags.includes("fact") || /\bhost\b|\bservice\b|\buser\b|\bidentity\b/.test(haystack)) return "fact";
	return null;
}

function buildPromotionTarget(
	episode: EpisodeRecord,
	type: string,
	title: string,
	importance: string,
	tags: string[],
): PromotionTarget | null {
	const derivedTitle = title || `${type} from ${String(episode.attributes.id ?? "episode")}`;
	const slug = normalizeSlug(derivedTitle);
	if (!slug) return null;
	const room = episodeRoom(episode.attributes);

	return {
		type,
		slug,
		title: derivedTitle,
		summary: typeof episode.attributes.title === "string" ? `${type}: ${episode.attributes.title}` : type,
		tags,
		confidence: defaultConfidence(importance),
		scope: room ? "room" : "global",
		scope_value: room || undefined,
		status: "active",
		salience: defaultSalience(importance),
	};
}

function inferTargetFromEpisode(episode: EpisodeRecord): PromotionTarget | null {
	const title = typeof episode.attributes.title === "string" ? episode.attributes.title : "";
	const kind = String(episode.attributes.kind ?? "observation").toLowerCase();
	const importance = String(episode.attributes.importance ?? "medium").toLowerCase();
	const tags = episodeTags(episode.attributes);
	const haystack = `${title}\n${episode.body}\n${tags.join(" ")}`.toLowerCase();

	if (episodeAlreadyPromoted(episode.attributes)) return null;
	if (importance !== "high" && kind !== "resolution" && kind !== "decision-point") return null;
	if (/\bmaybe\b|\bperhaps\b|\bguess\b|\bunclear\b|\bspeculat/i.test(haystack)) return null;

	const type = inferPromotionType(kind, tags, haystack);
	if (!type) return null;
	return buildPromotionTarget(episode, type, title, importance, tags);
}

export function consolidateEpisodes(params: {
	day?: string;
	kind?: string;
	limit?: number;
	mode?: "propose" | "apply";
	projectName?: string;
}) {
	const episodes = loadEpisodes(params);
	const proposals = episodes
		.map((episode) => ({
			episode,
			target: inferTargetFromEpisode(episode),
		}))
		.filter((entry): entry is { episode: EpisodeRecord; target: PromotionTarget } => entry.target !== null);

	if (proposals.length === 0) {
		return {
			content: [{ type: "text" as const, text: "No conservative promotion candidates found" }],
			details: { count: 0, applied: 0 },
		};
	}

	if (params.mode === "apply") {
		const applied: string[] = [];
		for (const proposal of proposals) {
			const episodeId = String(proposal.episode.attributes.id ?? "");
			const result = promoteEpisode({
				episode_id: episodeId,
				target: proposal.target,
				mode: "upsert",
				projectName: params.projectName,
			});
			if (!("isError" in result && result.isError)) {
				applied.push(`${episodeRef(episodeId)} -> ${proposal.target.type}/${proposal.target.slug}`);
			}
		}
		return {
			content: [{ type: "text" as const, text: applied.join("\n") || "No candidates applied" }],
			details: { count: proposals.length, applied: applied.length },
		};
	}

	const text = proposals
		.map((proposal) => {
			const episodeId = String(proposal.episode.attributes.id ?? "unknown");
			return `${episodeRef(episodeId)} -> ${proposal.target.type}/${proposal.target.slug}\n  ${proposal.target.summary}`;
		})
		.join("\n");
	return {
		content: [{ type: "text" as const, text }],
		details: { count: proposals.length, applied: 0 },
	};
}

export function promoteEpisode(params: {
	episode_id: string;
	target: PromotionTarget;
	mode?: "upsert" | "create";
	projectName?: string;
}) {
	const episodePath = findEpisodePath(params.episode_id);
	if (!episodePath) return errorResult(`episode not found: ${params.episode_id}`);

	const raw = fs.readFileSync(episodePath, "utf-8");
	const parsed = parseFrontmatter<Record<string, unknown>>(raw);
	const sourceRef = episodeRef(params.episode_id);
	const target = conservativeDefaults(params.target, parsed.attributes);

	const objectsDir = path.join(getNixPiDir(), "Objects");
	let objectPath: string;
	try {
		objectPath = safePath(objectsDir, `${target.slug}.md`);
	} catch {
		return errorResult("Path traversal blocked: invalid promotion slug");
	}

	const existing = readMemoryRecord(objectPath);
	if (params.mode === "create" && existing) {
		return errorResult(`object already exists: ${target.type}/${target.slug}`);
	}

	const source = existing?.attributes.source;
	const sourceRefs = Array.isArray(source) ? [...(source as string[])] : [];
	if (!sourceRefs.includes(sourceRef)) sourceRefs.push(sourceRef);

	const attributes = mergeObjectState({
		type: target.type,
		slug: target.slug,
		fields: {
			title: target.title ?? parsed.attributes.title ?? target.slug,
			summary: target.summary,
			scope: target.scope,
			scope_value:
				target.scope_value ??
				(target.scope === "project" ? params.projectName : undefined) ??
				(target.scope === "room" && typeof parsed.attributes.room === "string" ? parsed.attributes.room : undefined),
			confidence: target.confidence,
			status: target.status,
			salience: target.salience,
			tags: target.tags,
			source: sourceRefs,
		},
		existing: existing?.attributes,
	});

	writeMemoryRecord({
		filepath: objectPath,
		attributes,
		body: existing?.body ?? buildPromotionBody(String(attributes.title ?? target.slug), parsed.body, sourceRef),
	});
	updateEpisodeDerivedObjects(episodePath, `${target.type}/${target.slug}`);

	return {
		content: [{ type: "text" as const, text: `promoted ${sourceRef} -> ${target.type}/${target.slug}` }],
		details: { episode: sourceRef, target: `${target.type}/${target.slug}`, existed: Boolean(existing) },
	};
}
