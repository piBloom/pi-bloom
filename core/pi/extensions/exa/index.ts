/**
 * exa — Web search, URL fetching, and code-context lookup via the Exa API.
 *
 * @tools exa_search, exa_fetch, exa_code_context
 * @commands exa-status
 */
import { type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";

const EXA_API_BASE = "https://api.exa.ai";

const SearchContentTypeEnum = StringEnum(["text", "highlights", "summary", "none"] as const);
const FetchContentTypeEnum = StringEnum(["text", "highlights", "summary"] as const);
const TokensNumEnum = Type.Union([
	Type.Literal("dynamic"),
	Type.Number({ description: "Token limit between 50 and 100000." }),
]);

const ExaSearchParams = Type.Object({
	query: Type.String({ description: "Natural language search query." }),
	contentType: Type.Optional(SearchContentTypeEnum),
	numResults: Type.Optional(Type.Number({ description: "Number of results (1-100).", default: 10 })),
});

const ExaFetchParams = Type.Object({
	url: Type.String({ description: "URL to fetch content from." }),
	contentType: Type.Optional(FetchContentTypeEnum),
	maxCharacters: Type.Optional(
		Type.Number({ description: "Maximum characters to return (1000-100000).", default: 10000 }),
	),
});

const ExaCodeContextParams = Type.Object({
	query: Type.String({ description: "Search query for code snippets and examples." }),
	tokensNum: Type.Optional(TokensNumEnum),
});

type SearchContentType = Static<typeof SearchContentTypeEnum>;
type FetchContentType = Static<typeof FetchContentTypeEnum>;
type SearchParams = Static<typeof ExaSearchParams>;
type FetchParams = Static<typeof ExaFetchParams>;
type CodeContextParams = Static<typeof ExaCodeContextParams>;

type ExaResult = {
	title?: string;
	url: string;
	publishedDate?: string | null;
	author?: string | null;
	text?: string;
	highlights?: string[];
	summary?: string;
};

type ExaSearchResponse = {
	results?: ExaResult[];
	costDollars?: { total: number };
};

type ExaContextResponse = {
	query: string;
	response: string;
	resultsCount: number;
	costDollars: string | { total: number };
	outputTokens: number;
};

function getApiKey(): string | undefined {
	const value = process.env.EXA_API_KEY?.trim();
	return value && value.length > 0 ? value : undefined;
}

function requireApiKey(): string {
	const apiKey = getApiKey();
	if (!apiKey) {
		throw new Error("Exa API key not configured. Set EXA_API_KEY before starting pi.");
	}
	return apiKey;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function parseCost(cost: string | { total: number } | undefined): { total: number } | undefined {
	if (!cost) return undefined;
	if (typeof cost === "string") return JSON.parse(cost) as { total: number };
	return cost;
}

function buildSearchContents(contentType: SearchContentType | undefined) {
	switch (contentType) {
		case "text":
			return { text: true };
		case "highlights":
			return { highlights: true };
		case "summary":
			return { summary: true };
		case "none":
			return undefined;
		default:
			return { highlights: true };
	}
}

function buildFetchContents(contentType: FetchContentType | undefined, maxCharacters: number | undefined) {
	const boundedMaxChars = maxCharacters ? clamp(maxCharacters, 1000, 100000) : undefined;
	switch (contentType) {
		case "highlights":
			return { highlights: true };
		case "summary":
			return { summary: true };
		case "text":
		default:
			return boundedMaxChars ? { text: { maxCharacters: boundedMaxChars } } : { text: true };
	}
}

async function exaRequest<TResponse>(
	endpoint: string,
	body: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<TResponse> {
	const response = await fetch(`${EXA_API_BASE}${endpoint}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": requireApiKey(),
		},
		body: JSON.stringify(body),
		signal,
	});

	if (!response.ok) {
		const message = await response.text();
		throw new Error(`Exa API error (${response.status}): ${message}`);
	}

	return (await response.json()) as TResponse;
}

function truncateOutput(text: string): string {
	const truncation = truncateHead(text, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	if (!truncation.truncated) return truncation.content;
	return `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
}

function formatSearchResults(results: ExaResult[], cost?: { total: number }): string {
	const lines: string[] = [];
	for (const [index, result] of results.entries()) {
		lines.push(`--- Result ${index + 1} ---`);
		lines.push(`Title: ${result.title ?? "Untitled"}`);
		lines.push(`URL: ${result.url}`);
		if (result.publishedDate) lines.push(`Published: ${result.publishedDate}`);
		if (result.author) lines.push(`Author: ${result.author}`);
		if (result.highlights?.length) {
			lines.push("Highlights:");
			for (const highlight of result.highlights) lines.push(`  • ${highlight}`);
		}
		if (result.summary) {
			lines.push("Summary:");
			lines.push(result.summary);
		}
		if (result.text) {
			lines.push("Text:");
			lines.push(result.text);
		}
		lines.push("");
	}
	if (cost) lines.push(`Cost: $${cost.total.toFixed(6)}`);
	return lines.join("\n").trim();
}

function formatFetchResult(result: ExaResult, contentType: FetchContentType): string {
	const lines = [`Title: ${result.title ?? "Untitled"}`, `URL: ${result.url}`, ""];
	if (contentType === "highlights") {
		if (result.highlights?.length) {
			lines.push("Highlights:");
			for (const highlight of result.highlights) lines.push(`  • ${highlight}`);
		}
	} else if (contentType === "summary") {
		if (result.summary) {
			lines.push("Summary:");
			lines.push(result.summary);
		}
	} else if (result.text) {
		lines.push(result.text);
	}
	return lines.join("\n").trim();
}

function formatCodeContextResult(response: ExaContextResponse): string {
	const cost = parseCost(response.costDollars);
	const lines = [
		`Query: ${response.query}`,
		`Results: ${response.resultsCount} sources`,
		`Output tokens: ${response.outputTokens}`,
		"",
		"--- Code Context ---",
		"",
		response.response,
	];
	if (cost) lines.push("", `Cost: $${cost.total.toFixed(6)}`);
	return lines.join("\n");
}

export default function exaExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (!getApiKey()) {
			ctx.ui.notify("Exa API key not configured. Set EXA_API_KEY to enable Exa tools.", "warning");
		}
	});

	pi.registerTool({
		name: "exa_search",
		label: "Exa Search",
		description: "Search the web using the Exa API. Best for external factual lookups and documentation discovery.",
		parameters: ExaSearchParams,
		async execute(_toolCallId, params, signal) {
			const typed = params as SearchParams;
			const response = await exaRequest<ExaSearchResponse>(
				"/search",
				{
					query: typed.query,
					numResults: clamp(typed.numResults ?? 10, 1, 100),
					...(buildSearchContents(typed.contentType) ? { contents: buildSearchContents(typed.contentType) } : {}),
				},
				signal,
			);
			const results = response.results ?? [];
			return {
				content: [{ type: "text", text: truncateOutput(formatSearchResults(results, response.costDollars)) }],
				details: {
					query: typed.query,
					numResults: results.length,
					cost: response.costDollars,
				},
			};
		},
	});

	pi.registerTool({
		name: "exa_fetch",
		label: "Exa Fetch",
		description: "Fetch clean content from a specific URL using the Exa API.",
		parameters: ExaFetchParams,
		async execute(_toolCallId, params, signal) {
			const typed = params as FetchParams;
			const contentType = typed.contentType ?? "text";
			const response = await exaRequest<ExaSearchResponse>(
				"/contents",
				{
					urls: [typed.url],
					...buildFetchContents(contentType, typed.maxCharacters),
				},
				signal,
			);
			const result = response.results?.[0];
			if (!result) {
				return {
					content: [{ type: "text", text: "No content found at this URL." }],
					details: { url: typed.url, title: undefined, cost: response.costDollars },
				};
			}
			return {
				content: [{ type: "text", text: truncateOutput(formatFetchResult(result, contentType)) }],
				details: {
					url: typed.url,
					title: result.title,
					cost: response.costDollars,
				},
			};
		},
	});

	pi.registerTool({
		name: "exa_code_context",
		label: "Exa Code Context",
		description: "Search for code snippets and implementation examples from the web and open-source repositories.",
		parameters: ExaCodeContextParams,
		async execute(_toolCallId, params, signal) {
			const typed = params as CodeContextParams;
			const response = await exaRequest<ExaContextResponse>(
				"/context",
				{
					query: typed.query,
					tokensNum: typed.tokensNum ?? "dynamic",
				},
				signal,
			);
			return {
				content: [{ type: "text", text: truncateOutput(formatCodeContextResult(response)) }],
				details: {
					query: typed.query,
					resultsCount: response.resultsCount,
					outputTokens: response.outputTokens,
					cost: parseCost(response.costDollars),
				},
			};
		},
	});

	pi.registerCommand("exa-status", {
		description: "Check whether EXA_API_KEY is configured for the current Pi process.",
		handler: async (_args: string, ctx: ExtensionContext) => {
			ctx.ui.notify(
				getApiKey()
					? "Exa API key: configured via EXA_API_KEY"
					: "Exa API key: not configured. Set EXA_API_KEY before starting pi.",
				getApiKey() ? "info" : "warning",
			);
		},
	});
}
