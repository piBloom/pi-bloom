// ── App path helpers ──────────────────────────────────────────────────────
const NIXPI_BASE_PATH = (() => {
	const path = window.location.pathname;
	return path === "/nixpi" || path.startsWith("/nixpi/") ? "/nixpi" : "";
})();
function appUrl(path) {
	return `${NIXPI_BASE_PATH}${path}`;
}

// ── Markdown setup ────────────────────────────────────────────────────────
function md(text) {
	if (!text) return "";
	const source = String(text);
	if (typeof DOMPurify === "undefined") return plainTextHtml(source);

	let raw =
		typeof marked !== "undefined"
			? marked.parse(source, { breaks: true, gfm: true })
			: simpleMd(source);
	raw = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
	return hardenLinks(raw);

	function hardenLinks(html) {
		return html.replace(
			/<a\s+/g,
			'<a target="_blank" rel="noopener noreferrer" ',
		);
	}

	function plainTextHtml(t) {
		return t
			.split(/\n\n+/)
			.map((p) => p.trim())
			.filter(Boolean)
			.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
			.join("");
	}

	function simpleMd(t) {
		let r = t;
		r = r.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>");
		r = r.replace(/`([^`]+)`/g, "<code>$1</code>");
		r = r.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
		r = r.replace(/\*([^*]+)\*/g, "<em>$1</em>");
		r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
		r = r.replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>");
		r = r.replace(/(<li>.*<\/li>\s*)+/g, "<ul>$&</ul>");
		r = r.replace(/^>\s+(.+)$/gm, "<blockquote>$1</blockquote>");
		const paragraphs = r.split(/\n\n+/);
		return paragraphs
			.map((p) => {
				p = p.trim();
				if (!p) return "";
				if (p.startsWith("<")) return p;
				return "<p>" + p.replace(/\n/g, "<br>") + "</p>";
			})
			.join("");
	}
}
function esc(s) {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

// ── DOM refs ──────────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const msgs = $("#messages");
const input = $("#input");
const sendBtn = $("#send-btn");
const abortBtn = $("#btn-abort");
const statusLabel = $("#status-dot");
const sessionList = $("#session-list");
const imagePreviews = $("#image-previews");
const eventLog = $("#event-log");
const sidebarLeft = $("#sidebar-left");
const sidebarOverlay = $("#sidebar-overlay");
const diagModelBar = $("#diag-model-bar");
const diagCtxBar = $("#diag-ctx-bar");
const diagModelText = $("#diag-model");
const diagCtxText = $("#diag-ctx");

function setStatus(text, busy = false) {
	if (!statusLabel) return;
	statusLabel.textContent = text;
}

function logEvent(msg) {
	const time = new Date().toLocaleTimeString("en", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	const div = document.createElement("div");
	div.className = "text-on-surface";
	div.textContent = `[${time}] ${msg}`;
	eventLog.appendChild(div);
	eventLog.scrollTop = eventLog.scrollHeight;
}

// ── State ─────────────────────────────────────────────────────────────────
let ws = null,
	reconnectTimer = null;
let streaming = false;
let currentAssistantEl = null,
	currentThinkingEl = null,
	currentToolCalls = {};
let allCommands = [],
	filteredCmds = [],
	activeCmdIndex = -1;
let currentSessionFile = null;
let sidebarOpen = false;
let currentModel = null,
	currentThinkingLevel = null;
let currentModelSupportsImages = true;
let allModels = [];
let pendingImages = [];
let userScrolledUp = false;

// ── Theme ───────────────────────────────────────────────────────────────
const THEME_KEY = "nixpi-theme";
const DARK = "dark";
const LIGHT = "light";

function getSystemPrefersDark() {
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme() {
	const stored = localStorage.getItem(THEME_KEY);
	if (stored === DARK || stored === LIGHT) return stored;
	return getSystemPrefersDark() ? DARK : LIGHT;
}

function applyTheme(mode) {
	const html = document.documentElement;
	if (mode === DARK) {
		html.classList.add(DARK);
	} else {
		html.classList.remove(DARK);
	}
	// Update meta theme-color for mobile browsers
	const meta = document.getElementById("meta-theme-color");
	if (meta) {
		meta.content = mode === DARK ? "#1a110f" : "#fff8f6";
	}
	// Update the icon
	const icon = document.getElementById("theme-icon");
	if (icon) {
		icon.textContent = mode === DARK ? "dark_mode" : "light_mode";
	}
	// Update apple status bar
	const appleBar = document.getElementById("meta-apple-status-bar");
	if (appleBar) {
		appleBar.content = mode === DARK ? "black-translucent" : "default";
	}
	localStorage.setItem(THEME_KEY, mode);
}

function toggleTheme() {
	const current = document.documentElement.classList.contains(DARK)
		? DARK
		: LIGHT;
	const next = current === DARK ? LIGHT : DARK;
	applyTheme(next);
}

// Initialize theme before first paint (inline in <head> would be ideal,
// but this is the earliest we can do it in this single-file setup).
applyTheme(resolveTheme());

// Listen for system preference changes (only when no explicit choice stored)
window
	.matchMedia("(prefers-color-scheme: dark)")
	.addEventListener("change", (e) => {
		if (!localStorage.getItem(THEME_KEY)) {
			applyTheme(e.matches ? DARK : LIGHT);
		}
	});

// ── Sidebar ───────────────────────────────────────────────────────────────
function toggleLeftSidebar() {
	sidebarOpen = !sidebarOpen;
	sidebarLeft.classList.toggle("open", sidebarOpen);
	sidebarOverlay.style.display = sidebarOpen ? "block" : "none";
}
function newChat() {
	if (!ws || ws.readyState !== 1) return;
	ws.send(JSON.stringify({ type: "new_session" }));
	if (window.innerWidth <= 1024) toggleLeftSidebar();
}

// ── Scroll ─────────────────────────────────────────────────────────────────
window.addEventListener("scroll", () => {
	const atBottom =
		window.innerHeight + window.scrollY >=
		document.documentElement.scrollHeight - 100;
	userScrolledUp = !atBottom;
});
function scrollBottom() {
	if (!userScrolledUp) {
		msgs.scrollTop = msgs.scrollHeight;
	}
}

function replaceToolCall(details, summaryText, previewText) {
	const summary = document.createElement("summary");
	summary.textContent = summaryText;
	if (previewText === undefined) {
		details.replaceChildren(summary);
		return;
	}
	const pre = document.createElement("pre");
	pre.textContent = previewText;
	details.replaceChildren(summary, pre);
}

// ── Message helpers ────────────────────────────────────────────────────────
function divWithClass(className) {
	const div = document.createElement("div");
	div.className = className;
	return div;
}

function iconSpan(name, className) {
	const span = document.createElement("span");
	span.className = className;
	span.textContent = name;
	return span;
}

function avatar(kind) {
	if (kind === "error") {
		const el = divWithClass(
			"w-8 h-8 rounded-full bg-error-container flex items-center justify-center border border-error flex-shrink-0",
		);
		el.appendChild(
			iconSpan("error", "material-symbols-outlined text-error text-sm"),
		);
		return el;
	}
	if (kind === "user") {
		const el = divWithClass(
			"w-8 h-8 rounded-full bg-primary-container flex items-center justify-center border border-primary flex-shrink-0",
		);
		el.appendChild(
			iconSpan("OP", "font-label-md text-on-primary-container text-xs"),
		);
		return el;
	}
	const el = divWithClass(
		"w-8 h-8 rounded-full bg-surface-container flex items-center justify-center border border-outline-variant flex-shrink-0",
	);
	el.appendChild(
		iconSpan(
			kind === "assistant" ? "auto_awesome" : "info",
			`material-symbols-outlined ${kind === "assistant" ? "text-primary" : "text-on-surface-variant"} text-sm`,
		),
	);
	return el;
}

function setMarkdown(el, text) {
	// Sanitizer boundary: markdown is intentionally rendered as HTML here.
	// md() uses marked + DOMPurify when available; keep all chat markdown on this path.
	el.innerHTML = md(text);
}

function addMsg(type, content, options = {}) {
	const wrapper = divWithClass("flex gap-4");
	wrapper.dataset.type = type;

	if (type === "error" || type === "system") {
		const text = divWithClass(
			type === "error"
				? "text-error font-label-sm"
				: "text-on-surface-variant font-label-sm",
		);
		text.textContent = content;
		const body = divWithClass("flex-1");
		body.appendChild(text);
		wrapper.append(avatar(type), body);
	} else if (type === "user") {
		wrapper.classList.add("flex-row-reverse");
		const body = divWithClass("flex-1 flex justify-end");
		const bubble = divWithClass(
			"font-body-md text-on-surface bg-surface-container-high border border-outline-variant rounded-lg rounded-tr-none px-4 py-2 max-w-[80%]",
		);
		setMarkdown(bubble, content);
		const messageImages = options.images || pendingImages;
		if (messageImages.length) {
			const images = divWithClass("flex gap-1 mt-2");
			for (const pending of messageImages) {
				const img = document.createElement("img");
				img.src = pending.dataUrl;
				img.className =
					"w-16 h-16 object-cover rounded border border-outline-variant";
				images.appendChild(img);
			}
			bubble.appendChild(images);
		}
		body.appendChild(bubble);
		wrapper.append(avatar("user"), body);
	} else if (type === "assistant") {
		const body = divWithClass("flex-1 space-y-2");
		const message = divWithClass("msg-body font-body-md text-on-surface");
		const markdown = divWithClass("msg-markdown");
		setMarkdown(markdown, content);
		message.appendChild(markdown);
		body.appendChild(message);
		wrapper.append(avatar("assistant"), body);
	}
	msgs.appendChild(wrapper);
	scrollBottom();
	return wrapper;
}

function addUserMsg(text, images = pendingImages) {
	addMsg("user", text, { images });
}

function ensureAssistantMsg() {
	if (!currentAssistantEl) {
		const wrapper = divWithClass("flex gap-4");
		const body = divWithClass("flex-1 space-y-2");
		const message = divWithClass("msg-body font-body-md text-on-surface");
		message.appendChild(divWithClass("msg-markdown"));
		body.appendChild(message);
		wrapper.append(avatar("assistant"), body);
		msgs.appendChild(wrapper);
		currentAssistantEl = wrapper;
	}
	return currentAssistantEl.querySelector(".msg-body");
}

function ensureAssistantMarkdown() {
	const body = ensureAssistantMsg();
	let markdown = body.querySelector(":scope > .msg-markdown");
	if (!markdown) {
		markdown = divWithClass("msg-markdown");
		body.prepend(markdown);
	}
	return markdown;
}

function ensureThinking() {
	if (!currentThinkingEl) {
		const body = ensureAssistantMsg();
		const thinking = divWithClass("msg-thinking");
		const label = divWithClass(
			"font-label-md text-label-md text-secondary mb-1",
		);
		label.textContent = "Thinking…";
		const pre = document.createElement("pre");
		pre.className = "font-label-sm text-tertiary-fixed";
		thinking.append(label, pre);
		body.appendChild(thinking);
		currentThinkingEl = thinking;
		scrollBottom();
	}
	return currentThinkingEl.querySelector("pre");
}

// ── Session management ────────────────────────────────────────────────────
// ── Workspace management ──────────────────────────────────
let activeWorkspace = "default";
let workspacesInfo = {};

function switchWorkspace(name) {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	if (name === activeWorkspace) return;
	ws.send(JSON.stringify({ type: "switch_workspace", name }));
}

function updateWorkspaceUI(data) {
	const switcher = document.getElementById("workspace-switcher");
	const select = document.getElementById("workspace-select");
	if (!switcher || !select) return;

	const entries = Object.values(data);
	if (entries.length <= 1) {
		switcher.classList.add("hidden");
		return;
	}

	switcher.classList.remove("hidden");
	select.replaceChildren();
	for (const ws of entries) {
		const opt = document.createElement("option");
		opt.value = ws.name;
		opt.textContent = ws.context ? `${ws.name} — ${ws.context}` : ws.name;
		if (ws.active) opt.selected = true;
		select.appendChild(opt);
	}
	// Update the active indicator
	const active = entries.find((w) => w.active);
	if (active) activeWorkspace = active.name;
}
// ── End workspace ──────────────────────────────────────────

async function loadSessions() {
	try {
		const res = await fetch(appUrl("/api/sessions"));
		const data = await res.json();
		const active = data.currentFile || currentSessionFile;
		if (data.currentFile) currentSessionFile = data.currentFile;
		renderSessionList(data.sessions || [], active);
	} catch {
		const error = document.createElement("p");
		error.className = "text-on-surface-variant font-label-sm text-xs";
		error.textContent = "Could not load sessions";
		sessionList.replaceChildren(error);
	}
}

function formatRelTime(ts) {
	const d = new Date(ts),
		now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	if (+dayStart >= +todayStart)
		return d.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
	if (+dayStart >= +todayStart - 86400000) return "Yesterday";
	return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function groupByDate(sessions) {
	const now = new Date(),
		todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const groups = [
		{ label: "Today", items: [], threshold: +todayStart },
		{ label: "Yesterday", items: [], threshold: +todayStart - 86400000 },
		{
			label: "This Week",
			items: [],
			threshold: +todayStart - 7 * 86400000,
		},
		{
			label: "This Month",
			items: [],
			threshold: +todayStart - 30 * 86400000,
		},
		{ label: "Older", items: [], threshold: 0 },
	];
	for (const s of sessions) {
		const t = +new Date(s.lastTimestamp);
		for (const g of groups) {
			if (t >= g.threshold) {
				g.items.push(s);
				break;
			}
		}
	}
	return groups.filter((g) => g.items.length > 0);
}

function renderSessionList(sessions, activeFile) {
	if (!sessions.length) {
		const empty = document.createElement("p");
		empty.className = "text-on-surface-variant font-label-sm text-xs";
		empty.textContent = "No sessions yet";
		sessionList.replaceChildren(empty);
		return;
	}

	const nodes = [];
	for (const g of groupByDate(sessions)) {
		const label = document.createElement("div");
		label.className =
			"font-label-sm text-on-surface-variant uppercase tracking-wider text-xs mb-1 mt-2";
		label.textContent = g.label;
		nodes.push(label);

		for (const s of g.items) {
			const isActive = s.file === activeFile;
			const time = formatRelTime(s.lastTimestamp);
			const item = document.createElement("ds-session-item");
			item.dataset.file = s.file;
			item.setAttribute("title", s.preview || "");
			item.setAttribute("subtitle", `${time} · ${s.messageCount || 0} msgs`);
			if (isActive) item.setAttribute("active", "");
			item.addEventListener("click", () => switchSession(s.file));
			nodes.push(item);
		}
	}
	sessionList.replaceChildren(...nodes);
}

function switchSession(sessionPath) {
	if (!ws || ws.readyState !== 1) return;
	ws.send(JSON.stringify({ type: "switch_session", sessionPath }));
	if (window.innerWidth <= 1024) toggleLeftSidebar();
}

// ── Model picker ──────────────────────────────────────────────────────────
function openModelPicker() {
	if (!allModels.length) {
		ws?.send(JSON.stringify({ type: "get_models" }));
	}
	const val = document.getElementById("model-search")?.value || "";
	filterModels(val);
	openModal("model-modal");
	setTimeout(() => document.getElementById("model-search")?.focus(), 50);
}
function filterModels(q) {
	q = (q || "").toLowerCase();
	const filtered = allModels.filter(
		(m) =>
			!q ||
			m.id.toLowerCase().includes(q) ||
			m.provider.toLowerCase().includes(q) ||
			(m.name || "").toLowerCase().includes(q),
	);
	const byProvider = {};
	for (const m of filtered) {
		if (!byProvider[m.provider]) byProvider[m.provider] = [];
		byProvider[m.provider].push(m);
	}
	const container = document.getElementById("model-list");
	const currentId = currentModel?.id;
	const nodes = [];

	for (const [provider, models] of Object.entries(byProvider)) {
		const label = document.createElement("div");
		label.className =
			"font-label-sm text-secondary uppercase tracking-wider text-xs mb-2 mt-3";
		label.textContent = provider;
		nodes.push(label);

		for (const m of models) {
			const isCurrent = m.id === currentId;
			const hasVision = Array.isArray(m.input) && m.input.includes("image");
			const button = document.createElement("ds-button");
			button.setAttribute("variant", "text");
			button.setAttribute("size", "md");
			button.setAttribute("full", "");
			if (isCurrent) {
				button.classList.add("text-primary");
				button.disabled = true;
			}
			button.addEventListener("click", () => setModel(m.provider, m.id));

			const name = document.createElement("span");
			name.className = "font-label-md text-sm";
			name.textContent = `${m.name || m.id}${hasVision ? " 📷" : ""}${isCurrent ? " ✓" : ""}`;
			button.appendChild(name);
			nodes.push(button);
		}
	}

	if (!nodes.length) {
		const empty = document.createElement("p");
		empty.className = "text-on-surface-variant text-sm p-2";
		empty.textContent = "No models found";
		nodes.push(empty);
	}

	container.replaceChildren(...nodes);
}
function setModel(provider, modelId) {
	ws?.send(JSON.stringify({ type: "set_model", provider, modelId }));
	closeModal("model-modal");
	logEvent(`Switching model → ${modelId}`);
}
function cycleThinking() {
	if (!ws || ws.readyState !== 1) return;
	ws.send(JSON.stringify({ type: "cycle_thinking_level" }));
}

// ── Stats ─────────────────────────────────────────────────────────────────
function updateStats(stats) {
	if (!stats) return;
	const tok = stats.tokens?.total || 0;
	const msgs_count = (stats.userMessages || 0) + (stats.assistantMessages || 0);
	const ctx =
		stats.contextUsage?.percent != null
			? Math.round(stats.contextUsage.percent)
			: 0;

	$("#stats-panel").classList.remove("hidden");
	$("#stat-tokens").textContent = tok.toLocaleString();
	$("#stat-msgs").textContent = msgs_count;
	$("#stat-ctx").textContent = ctx + "%";

	diagModelText.textContent = currentModel?.name || "—";
	diagCtxText.textContent = ctx + "%";
	diagModelBar.style.width = Math.min(100, (tok / 10000) * 100) + "%";
	diagCtxBar.style.width = Math.min(100, ctx) + "%";
}

// ── Modal helpers ─────────────────────────────────────────────────────────
function openModal(id) {
	const el = document.getElementById(id);
	if (!el || el.open) return;
	if (el.showModal) el.showModal();
	else el.setAttribute("open", "");
}
function closeModal(id) {
	const el = document.getElementById(id);
	if (!el) return;
	if (el.close && el.open) el.close();
	else el.removeAttribute("open");
}

// ── Image attachment ──────────────────────────────────────────────────────
function addImagePreview(dataUrl, mimeType) {
	const image = { dataUrl, mimeType };
	pendingImages.push(image);

	const wrap = document.createElement("div");
	wrap.className = "image-preview";

	const thumbnail = document.createElement("img");
	thumbnail.src = dataUrl;
	thumbnail.alt = "Attached";

	const remove = document.createElement("ds-button");
	remove.setAttribute("variant", "fab");
	remove.setAttribute("size", "xs");
	remove.setAttribute("primary", "");
	remove.textContent = "×";
	remove.addEventListener("click", () => {
		wrap.remove();
		pendingImages = pendingImages.filter((pending) => pending !== image);
	});

	wrap.append(thumbnail, remove);
	imagePreviews.appendChild(wrap);
}
function fileToDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = (e) => resolve(e.target.result);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}
async function handleFiles(files) {
	for (const file of files) {
		if (!file.type.startsWith("image/")) continue;
		const dataUrl = await fileToDataUrl(file);
		addImagePreview(dataUrl, file.type);
	}
}

// ── Export ────────────────────────────────────────────────────────────────
function exportSession() {
	if (!ws || ws.readyState !== 1) {
		logEvent("Not connected — cannot export");
		return;
	}
	ws.send(JSON.stringify({ type: "export_request" }));
}

// ── Restart Pi ────────────────────────────────────────────────────────────
function restartPi() {
	fetch(appUrl("/api/restart"), { method: "POST" })
		.then(() => {
			logEvent("Restarting Pi…");
		})
		.catch((e) => {
			logEvent("Restart failed: " + e.message);
		});
}

// ── WebSocket ─────────────────────────────────────────────────────────────
function connect() {
	const proto = location.protocol === "https:" ? "wss:" : "ws:";
	ws = new WebSocket(`${proto}//${location.host}${appUrl("/ws")}`);
	ws.onopen = () => {
		logEvent("WebSocket connected");
		setStatus("Connected");
		const savedSession = localStorage.getItem("nixpi_session");
		if (savedSession && !currentSessionFile) currentSessionFile = savedSession;
		ws.send(JSON.stringify({ type: "get_models" }));
		if (currentSessionFile) ws.send(JSON.stringify({ type: "load_history" }));
		loadSessions();
	};
	ws.onclose = (event) => {
		logEvent(`WebSocket closed (code ${event.code})`);
		setStatus("Disconnected");
		clearTimeout(reconnectTimer);
		reconnectTimer = setTimeout(connect, 2000);
	};
	ws.onerror = (err) => {
		ws.close();
	};
	ws.onmessage = (e) => {
		try {
			const data = JSON.parse(e.data);
			handleEvent(data);
		} catch (err) {}
	};
}

function handleEvent(data) {
	switch (data.type) {
		case "workspace_switched":
			activeWorkspace = data.workspace;
			if (data.workspaces) {
				workspacesInfo = data.workspaces;
				updateWorkspaceUI(data.workspaces);
			}
			// Reload sessions for the new workspace
			loadSessions();
			// Clear the chat area for the new workspace
			document.getElementById("messages").replaceChildren();
			currentAssistantEl = null;
			currentThinkingEl = null;
			break;

		case "workspaces":
			workspacesInfo = data.workspaces;
			if (data.active) activeWorkspace = data.active;
			updateWorkspaceUI(data.workspaces);
			break;

		case "status":
			streaming = data.busy;
			setStatus(data.busy ? "Busy" : "Connected", data.busy);
			// Handle workspace info in status messages (e.g. on connect)
			if (data.workspaces) {
				workspacesInfo = data.workspaces;
				updateWorkspaceUI(data.workspaces);
			}
			if (data.workspace) activeWorkspace = data.workspace;
			if (data.piConnected === false) {
				setStatus("Disconnected");
				const banner = document.getElementById("pi-health-banner");
				const msg = document.getElementById("health-msg");
				if (banner) banner.classList.remove("hidden");
				if (msg) msg.textContent = "⚠ Pi disconnected. Reconnecting…";
				abortBtn.disabled = true;
				sendBtn.disabled = true;
				sendBtn.textContent = "Disconnected";
				$("#node-pi-status").textContent = "Down";
				$("#node-pi-status").className =
					"text-[10px] uppercase font-bold text-error";
			} else {
				const banner = document.getElementById("pi-health-banner");
				if (banner) banner.classList.add("hidden");
				abortBtn.disabled = !data.busy;
				sendBtn.textContent = data.busy ? "Busy…" : "Send";
				sendBtn.disabled = false;
				$("#node-pi-status").textContent = "Operational";
				$("#node-pi-status").className =
					"text-[10px] uppercase font-bold text-tertiary";
			}
			if (data.aborted) {
				currentAssistantEl = null;
				currentThinkingEl = null;
				addMsg("system", "Aborted.");
			}
			break;

		case "pi_health":
			if (data.connected) {
				document.getElementById("pi-health-banner")?.classList.add("hidden");
				setStatus("Connected");
				sendBtn.textContent = streaming ? "Busy…" : "Send";
				sendBtn.disabled = false;
				$("#node-ws-status").textContent = "Connected";
				$("#node-ws-status").className =
					"text-[10px] uppercase font-bold text-tertiary";
			} else {
				setStatus("Disconnected");
				document.getElementById("pi-health-banner")?.classList.remove("hidden");
				abortBtn.disabled = true;
				sendBtn.disabled = true;
				sendBtn.textContent = "Disconnected";
				$("#node-ws-status").textContent = "Disconnected";
				$("#node-ws-status").className =
					"text-[10px] uppercase font-bold text-error";
			}
			break;

		case "error":
			addMsg("error", data.message || "Error");
			logEvent(`Error: ${data.message}`);
			break;

		case "commands":
			allCommands = data.commands || [];
			break;

		case "available_models":
			allModels = data.models || [];
			filterModels(document.getElementById("model-search")?.value || "");
			break;

		case "session_state":
			if (data.sessionFile) {
				currentSessionFile = data.sessionFile;
				localStorage.setItem("nixpi_session", currentSessionFile);
			}
			if (data.model) {
				currentModel = data.model;
				currentModelSupportsImages =
					Array.isArray(data.model.input) && data.model.input.includes("image");
				logEvent(`Model: ${data.model.name || data.model.id}`);
			}
			if (data.thinkingLevel) {
				currentThinkingLevel = data.thinkingLevel;
				const ind = $("#thinking-indicator");
				if (ind)
					ind.classList.toggle(
						"hidden",
						!data.thinkingLevel || data.thinkingLevel === "none",
					);
			}
			loadSessions();
			break;

		case "model_state":
			if (data.model) {
				currentModel = data.model;
				currentModelSupportsImages =
					Array.isArray(data.model.input) && data.model.input.includes("image");
				logEvent(`Model: ${data.model.name || data.model.id}`);
			}
			if (data.thinkingLevel) {
				currentThinkingLevel = data.thinkingLevel;
				const ind = $("#thinking-indicator");
				if (ind)
					ind.classList.toggle(
						"hidden",
						!data.thinkingLevel || data.thinkingLevel === "none",
					);
			}
			break;

		case "session_stats":
			updateStats(data.stats);
			break;

		case "session_switched":
			msgs.replaceChildren();
			currentAssistantEl = null;
			currentThinkingEl = null;
			currentToolCalls = {};
			streaming = false;
			loadSessions();
			logEvent("Session switched");
			break;

		case "session_reset":
			msgs.replaceChildren();
			currentAssistantEl = null;
			currentThinkingEl = null;
			currentToolCalls = {};
			setTimeout(loadSessions, 1200);
			logEvent("New session started");
			break;

		case "history":
			msgs.replaceChildren();
			if (data.messages?.length) {
				for (const m of data.messages) {
					if (m.role === "user") {
						const c = m.content;
						const text =
							typeof c === "string"
								? c
								: Array.isArray(c)
									? c
											.filter((b) => b.type === "text")
											.map((b) => b.text)
											.join("\n")
									: "";
						if (text) addMsg("user", text);
					} else if (m.role === "assistant" && m.content) {
						const text = m.content
							.filter((b) => b.type === "text")
							.map((b) => b.text)
							.join("");
						if (text) addMsg("assistant", text);
					}
				}
				scrollBottom();
			}
			loadSessions();
			logEvent(`History loaded: ${(data.messages || []).length} msgs`);
			break;

		case "agent_start":
			currentAssistantEl = null;
			currentThinkingEl = null;
			currentToolCalls = {};
			logEvent("Agent started");
			break;

		case "agent_end":
			currentAssistantEl = null;
			currentThinkingEl = null;
			streaming = false;
			setTimeout(loadSessions, 800);
			logEvent("Agent ended");
			break;

		case "message_start":
			if (data.message?.role === "assistant") {
				currentAssistantEl = null;
				currentThinkingEl = null;
			}
			break;

		case "message_update": {
			const evt = data.assistantMessageEvent;
			if (!evt) break;
			if (evt.type === "text_delta") {
				const markdown = ensureAssistantMarkdown();
				const text = (data.message?.content || [])
					.filter((c) => c.type === "text")
					.map((c) => c.text)
					.join("");
				setMarkdown(markdown, text);
				scrollBottom();
			} else if (evt.type === "thinking_delta") {
				const body = ensureThinking();
				const thinkText = (data.message?.content || [])
					.filter((c) => c.type === "thinking")
					.map((c) => c.thinking)
					.join("\n");
				body.textContent = thinkText || evt.delta || "";
				scrollBottom();
			} else if (evt.type === "thinking_start") {
				ensureThinking();
			} else if (evt.type === "thinking_end") {
				if (currentThinkingEl) {
					currentThinkingEl.remove();
					currentThinkingEl = null;
				}
			} else if (evt.type === "toolcall_start") {
				const name =
					(data.message?.content || []).find((c) => c.type === "toolCall")
						?.name || "…";
				if (!currentToolCalls[evt.toolCallId]) {
					const body = ensureAssistantMsg();
					const tc = document.createElement("details");
					tc.open = true;
					tc.className = "tool-call";
					tc.dataset.id = evt.toolCallId;
					replaceToolCall(tc, name);
					body.appendChild(tc);
					currentToolCalls[evt.toolCallId] = tc;
					scrollBottom();
				}
			} else if (evt.type === "toolcall_end") {
				const tc = currentToolCalls[evt.toolCallId];
				if (tc && evt.toolCall) {
					const args = evt.toolCall.arguments;
					const preview =
						typeof args === "string"
							? args.slice(0, 200)
							: JSON.stringify(args ?? {}).slice(0, 200);
					replaceToolCall(tc, evt.toolCall.name, preview);
				}
			}
			break;
		}

		case "message_end":
			currentAssistantEl = null;
			currentThinkingEl = null;
			break;

		case "tool_execution_start": {
			const body = ensureAssistantMsg();
			const te = document.createElement("details");
			te.className = "tool-call";
			te.open = true;
			replaceToolCall(te, `⚙ ${data.toolName} running…`);
			body.appendChild(te);
			currentToolCalls[data.toolCallId] = te;
			scrollBottom();
			logEvent(`Tool: ${data.toolName} running`);
			break;
		}

		case "tool_execution_end": {
			const te = currentToolCalls[data.toolCallId];
			if (te) {
				const result = data.result?.content?.[0]?.text || "done";
				replaceToolCall(te, `⚙ ${data.toolName}`, result.slice(0, 300));
			}
			logEvent(`Tool: ${data.toolName} done`);
			break;
		}

		case "export_response":
			if (data.session) {
				const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
				const blob = new Blob([JSON.stringify(data.session, null, 2)], {
					type: "application/json",
				});
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = `nixpi-session-${ts}.json`;
				a.click();
				URL.revokeObjectURL(url);
				addMsg("system", "Session exported.");
				logEvent("Session exported");
			}
			break;

		default:
			// Unknown events — log silently
			break;
	}
}

// ── Send ──────────────────────────────────────────────────────────────────
function sendPrompt() {
	const text = input.value.trim();
	if (!text || !ws || ws.readyState !== 1) return;

	if (pendingImages.length && !currentModelSupportsImages) {
		addMsg(
			"error",
			`${currentModel?.name || "This model"} doesn't support images — sending text only.`,
		);
		pendingImages = [];
		imagePreviews.replaceChildren();
	}

	const payload = { type: "prompt", text };
	if (pendingImages.length) {
		payload.images = pendingImages.map((img) => ({
			type: "image",
			data: img.dataUrl.split(",")[1],
			mimeType: img.mimeType,
		}));
	}

	const sentImages = pendingImages.slice();
	input.value = "";
	pendingImages = [];
	imagePreviews.replaceChildren();

	addUserMsg(text, sentImages);
	if (streaming) {
		logEvent("Queued follow-up");
	}
	ws.send(JSON.stringify(payload));
}

// ── Event wiring ──────────────────────────────────────────────────────────
sendBtn.addEventListener("click", sendPrompt);

input.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && e.ctrlKey && !e.shiftKey) {
		e.preventDefault();
		sendPrompt();
	}
	if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey && !e.altKey) {
		e.preventDefault();
		sendPrompt();
	}
});

input.addEventListener("paste", async (e) => {
	const items = e.clipboardData?.items || [];
	for (const item of items) {
		if (item.type.startsWith("image/")) {
			e.preventDefault();
			const file = item.getAsFile();
			if (file) await handleFiles([file]);
		}
	}
});

abortBtn.addEventListener("click", () => {
	if (!ws || ws.readyState !== 1) return;
	ws.send(JSON.stringify({ type: "abort" }));
});

$("#attach-btn").addEventListener("click", () => {
	if (!currentModelSupportsImages) return;
	$("#attach-input").click();
});
$("#attach-input").addEventListener("change", async (e) => {
	await handleFiles(Array.from(e.target.files));
	e.target.value = "";
});

document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		const openDialog = document.querySelector("dialog[open]");
		if (openDialog) {
			closeModal(openDialog.id);
			return;
		}
		if (streaming) {
			ws?.send(JSON.stringify({ type: "abort" }));
		}
		return;
	}
	if (document.activeElement === input) return;
	if (e.key === "n" && e.ctrlKey) {
		e.preventDefault();
		newChat();
	}
	if (e.key === "l" && e.ctrlKey) {
		e.preventDefault();
		msgs.replaceChildren();
		addMsg("system", "Chat cleared. Session history preserved.");
	}
	if (
		e.key === "?" &&
		!e.ctrlKey &&
		!e.altKey &&
		document.activeElement.tagName !== "TEXTAREA" &&
		document.activeElement.tagName !== "INPUT"
	) {
		openModal("help-modal");
	}
});

// Search sessions
$("#global-search").addEventListener("input", (e) => {
	const q = e.target.value.toLowerCase();
	document.querySelectorAll("ds-session-item").forEach((item) => {
		const text =
			`${item.getAttribute("title") || ""} ${item.getAttribute("subtitle") || ""}`.toLowerCase();
		item.style.display = text.includes(q) ? "block" : "none";
	});
});

// ── Mic / Whisper ─────────────────────────────────────────────────────────
const micBtn = $("#mic-btn");
let mediaRecorder = null;
let audioChunks = [];
let micRecording = false;
const micSilenceMs = 750;
let analyser = null;
let audioContext = null;
let silenceCheckInterval = null;

if (!navigator.mediaDevices?.getUserMedia) {
	if (micBtn) micBtn.style.display = "none";
}

function startSilenceDetection(stream) {
	if (micSilenceMs === 0) return;
	try {
		audioContext = new (window.AudioContext || window.webkitAudioContext)();
		const source = audioContext.createMediaStreamSource(stream);
		analyser = audioContext.createAnalyser();
		analyser.fftSize = 512;
		source.connect(analyser);
		const dataArray = new Uint8Array(analyser.frequencyBinCount);
		let silenceStart = null;
		const threshold = 15;
		silenceCheckInterval = setInterval(() => {
			analyser.getByteFrequencyData(dataArray);
			const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
			if (avg < threshold) {
				if (!silenceStart) silenceStart = Date.now();
				if (Date.now() - silenceStart >= micSilenceMs) stopRecording();
			} else {
				silenceStart = null;
			}
		}, 100);
	} catch (e) {}
}

function stopSilenceDetection() {
	if (silenceCheckInterval) {
		clearInterval(silenceCheckInterval);
		silenceCheckInterval = null;
	}
	if (audioContext) {
		audioContext.close().catch(() => {});
		audioContext = null;
	}
	analyser = null;
}

function setMicIcon(iconName, active = false) {
	const icon = document.createElement("span");
	icon.className = `material-symbols-outlined text-sm${active ? " text-primary" : ""}`;
	icon.textContent = iconName;
	micBtn.replaceChildren(icon);
	micBtn.classList.toggle("text-primary", active);
}

function stopRecording() {
	if (!micRecording) return;
	micRecording = false;
	stopSilenceDetection();
	if (mediaRecorder && mediaRecorder.state === "recording")
		mediaRecorder.stop();
	setMicIcon("hourglass_top", true);
}

if (micBtn) {
	micBtn.addEventListener("click", async () => {
		if (micRecording) {
			stopRecording();
		} else {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: true,
				});
				audioChunks = [];
				mediaRecorder = new MediaRecorder(stream, {
					mimeType: "audio/webm",
				});
				mediaRecorder.ondataavailable = (e) => {
					if (e.data.size > 0) audioChunks.push(e.data);
				};
				mediaRecorder.onstop = async () => {
					stream.getTracks().forEach((t) => t.stop());
					const blob = new Blob(audioChunks, { type: "audio/webm" });
					if (blob.size < 1000) {
						setMicIcon("mic");
						return;
					}
					try {
						const resp = await fetch(appUrl("/api/transcribe"), {
							method: "POST",
							headers: { "Content-Type": "audio/webm" },
							body: blob,
						});
						const data = await resp.json();
						if (data.text) {
							input.value = input.value
								? input.value + " " + data.text.trim()
								: data.text.trim();
						}
					} catch (e) {}
					setMicIcon("mic");
				};
				mediaRecorder.start();
				micRecording = true;
				setMicIcon("mic", true);
				startSilenceDetection(stream);
			} catch (e) {
				logEvent("Mic access denied");
			}
		}
	});
}

// ── Boot ──────────────────────────────────────────────────────────────────
connect();
input.focus();
