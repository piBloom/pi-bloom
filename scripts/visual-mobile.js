#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const appUrl = process.env.NIXPI_VISUAL_URL || "http://127.0.0.1:8081";
const outDir = resolve(
	process.env.NIXPI_VISUAL_DIR || "artifacts/mobile-visual",
);

function findChromium() {
	if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;

	const candidates = [
		"/nix/store/9fjg59mab9j8c5r61dx2k5gcbd2f5mpm-chromium-148.0.7778.96/bin/chromium",
		"chromium",
		"chromium-browser",
		"google-chrome",
	];

	for (const candidate of candidates) {
		if (candidate.startsWith("/")) {
			if (existsSync(candidate)) return candidate;
			continue;
		}
		try {
			return execFileSync("which", [candidate], { encoding: "utf8" }).trim();
		} catch {}
	}
	return null;
}

function screenshotPath(name) {
	return join(outDir, name);
}

async function prepareMobileScene(page) {
	await page.goto(appUrl, { waitUntil: "domcontentloaded" });
	await page.waitForFunction(() =>
		Boolean(window.customElements?.get("ds-button")),
	);
	await page.waitForFunction(() => typeof window.addMsg === "function");
	await page.evaluate(() => {
		window.applyTheme?.("dark");
		document.getElementById("messages")?.replaceChildren();
		window.addMsg?.(
			"system",
			"Mobile visual review mode: staged sample content for layout checking.",
		);
		window.addMsg?.(
			"assistant",
			"### Bun mobile check\nThe chat should feel usable one-handed: readable text, no horizontal overflow, and a composer that stays reachable above the safe area.\n\n```js\nconst longIdentifier = 'this_should_scroll_inside_the_code_block_without_breaking_the_page_width';\n```",
		);
		window.addMsg?.(
			"user",
			"Can I compare the Bun app on my phone without pinching or sideways scrolling?",
		);
		window.addMsg?.(
			"assistant",
			"Yes — the session list is a drawer, telemetry is hidden on mobile, and the composer compresses into a stacked action row.",
		);
		const input = document.querySelector("#input");
		if (input) input.value = "Ask the agent from mobile…";
	});
	await page.waitForTimeout(500);
	await page.evaluate(() => {
		window.renderSessionList?.(
			[
				{
					file: "visual-current.jsonl",
					preview: "Mobile Bun polish review",
					lastTimestamp: new Date().toISOString(),
					messageCount: 8,
				},
				{
					file: "visual-drawer.jsonl",
					preview: "Check drawer, search, and touch targets",
					lastTimestamp: new Date(Date.now() - 86_400_000).toISOString(),
					messageCount: 14,
				},
				{
					file: "visual-long.jsonl",
					preview:
						"A deliberately long session title that should truncate cleanly",
					lastTimestamp: new Date(Date.now() - 2 * 86_400_000).toISOString(),
					messageCount: 3,
				},
			],
			"visual-current.jsonl",
		);
	});
}

async function main() {
	mkdirSync(outDir, { recursive: true });
	const executablePath = findChromium();
	if (!executablePath) {
		throw new Error(
			"Chromium not found. Run inside `nix shell nixpkgs#chromium`, or set CHROMIUM_BIN.",
		);
	}

	const browser = await chromium.launch({
		executablePath,
		headless: true,
		args: ["--no-sandbox", "--disable-dev-shm-usage"],
	});

	try {
		const context = await browser.newContext({
			viewport: { width: 390, height: 844 },
			deviceScaleFactor: 2,
			isMobile: true,
			hasTouch: true,
			colorScheme: "dark",
			userAgent:
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
		});
		const page = await context.newPage();
		await prepareMobileScene(page);

		await page.screenshot({ path: screenshotPath("01-chat-mobile.png") });

		await page.click("#btn-sidebar-toggle");
		await page.waitForTimeout(300);
		await page.screenshot({ path: screenshotPath("02-session-drawer.png") });

		await page.mouse.click(382, 80);
		await page.waitForTimeout(200);
		await page.evaluate(() => window.openModal?.("help-modal"));
		await page.waitForTimeout(200);
		await page.screenshot({ path: screenshotPath("03-help-modal.png") });

		await page.setViewportSize({ width: 360, height: 740 });
		await page.evaluate(() => window.closeModal?.("help-modal"));
		await page.waitForTimeout(200);
		await page.screenshot({
			path: screenshotPath("04-narrow-chat-mobile.png"),
		});

		const metrics = await page.evaluate(() => ({
			viewport: `${window.innerWidth}x${window.innerHeight}`,
			scrollWidth: document.documentElement.scrollWidth,
			hasHorizontalOverflow:
				document.documentElement.scrollWidth > window.innerWidth + 2,
			rightSidebarDisplay: getComputedStyle(
				document.querySelector("#sidebar-right"),
			).display,
		}));

		console.log(`visual-mobile-url=${appUrl}`);
		console.log(`visual-mobile-dir=${outDir}`);
		console.log(`visual-mobile-browser=${executablePath}`);
		console.log(`visual-mobile-metrics=${JSON.stringify(metrics)}`);
		console.log("screenshots:");
		for (const name of [
			"01-chat-mobile.png",
			"02-session-drawer.png",
			"03-help-modal.png",
			"04-narrow-chat-mobile.png",
		]) {
			console.log(`- ${screenshotPath(name)}`);
		}
		if (metrics.hasHorizontalOverflow) process.exitCode = 1;
	} finally {
		await browser.close();
	}
}

main().catch((err) => {
	console.error(err.stack || String(err));
	process.exit(1);
});
