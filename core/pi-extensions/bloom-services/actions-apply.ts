/**
 * Manifest apply handler for bloom-services.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../lib/exec.js";
import { getQuadletDir } from "../../lib/filesystem.js";
import { writeServiceHomeRuntime } from "../../lib/service-home.js";
import { loadServiceCatalog } from "../../lib/services-catalog.js";
import { loadManifest, saveManifest } from "../../lib/services-manifest.js";
import { errorResult, requireConfirmation, truncate } from "../../lib/shared.js";
import { ensureServiceInstalled } from "./actions-install.js";

export async function handleManifestApply(
	params: {
		install_missing?: boolean;
		dry_run?: boolean;
	},
	bloomDir: string,
	manifestPath: string,
	repoDir: string,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const manifest = loadManifest(manifestPath);
	const serviceEntries = Object.entries(manifest.services).sort(([a], [b]) => a.localeCompare(b));
	if (serviceEntries.length === 0) {
		return errorResult("Manifest has no services. Use manifest_set_service first.");
	}

	const installMissing = params.install_missing ?? true;
	const dryRun = params.dry_run ?? false;

	if (!dryRun) {
		const denied = await requireConfirmation(ctx, `Apply manifest to ${serviceEntries.length} service(s)`);
		if (denied) return errorResult(denied);
	}

	const catalog = loadServiceCatalog(repoDir);
	const lines: string[] = [];
	const errors: string[] = [];
	let installedCount = 0;
	let startedCount = 0;
	let stoppedCount = 0;
	let enabledCount = 0;
	let disabledCount = 0;
	let manifestChanged = false;
	let needsReload = false;

	const systemdDir = getQuadletDir();
	const userSystemdDir = join(os.homedir(), ".config", "systemd", "user");

	for (const [name, svc] of serviceEntries) {
		if (!svc.enabled) continue;

		const unit = `bloom-${name}`;
		const containerDef = join(systemdDir, `${unit}.container`);
		if (existsSync(containerDef)) continue;

		if (!installMissing) {
			errors.push(`${name}: missing unit ${containerDef} (set install_missing=true to auto-install)`);
			continue;
		}

		const version = svc.version?.trim() || catalog[name]?.version || "latest";

		if (dryRun) {
			lines.push(`[dry-run] install ${name}@${version}`);
			installedCount += 1;
			continue;
		}

		const installResult = await ensureServiceInstalled(name, catalog, bloomDir, manifestPath, repoDir, signal);
		if (!installResult.ok) {
			errors.push(`${name}: install failed — ${installResult.note}`);
			continue;
		}

		installedCount += 1;
		needsReload = true;
		lines.push(`Installed ${name} from bundled local package`);

		const catalogEntry = installResult.catalogEntry;
		if (!svc.version) {
			manifest.services[name].version = version;
			manifestChanged = true;
		}
		if ((!svc.image || svc.image === "unknown") && catalogEntry?.image) {
			manifest.services[name].image = catalogEntry.image;
			manifestChanged = true;
		}
	}

	if (needsReload && !dryRun) {
		const reload = await run("systemctl", ["--user", "daemon-reload"], signal);
		if (reload.exitCode !== 0) {
			return errorResult(`manifest_apply: daemon-reload failed:\n${reload.stderr || reload.stdout}`);
		}
	}

	for (const [name, svc] of serviceEntries) {
		const unit = `bloom-${name}`;
		const containerDef = join(systemdDir, `${unit}.container`);
		const socketDef = join(userSystemdDir, `${unit}.socket`);
		const startTarget = existsSync(socketDef) ? `${unit}.socket` : `${unit}.service`;

		if (svc.enabled) {
			if (!existsSync(containerDef)) {
				errors.push(`${name}: cannot start, unit not installed`);
				continue;
			}

			if (dryRun) {
				lines.push(`[dry-run] enable/start ${startTarget}`);
				startedCount += 1;
				enabledCount += 1;
				continue;
			}

			const enableResult = await run("systemctl", ["--user", "enable", "--now", startTarget], signal);
			const startResult =
				enableResult.exitCode === 0 ? enableResult : await run("systemctl", ["--user", "start", startTarget], signal);
			if (startResult.exitCode !== 0) {
				errors.push(
					`${name}: failed to start ${startTarget}: ${startResult.stderr || startResult.stdout || enableResult.stderr || enableResult.stdout}`,
				);
			} else {
				startedCount += 1;
				if (enableResult.exitCode === 0) {
					enabledCount += 1;
					lines.push(`Enabled and started ${startTarget}`);
				} else {
					lines.push(
						`Started ${startTarget} (enable skipped: ${enableResult.stderr || enableResult.stdout || "not supported"})`,
					);
				}
			}
			continue;
		}

		if (dryRun) {
			lines.push(`[dry-run] disable/stop ${unit}.socket (if present)`);
			lines.push(`[dry-run] disable/stop ${unit}.service`);
			stoppedCount += 1;
			disabledCount += 1;
			continue;
		}

		const disableSocket = await run("systemctl", ["--user", "disable", "--now", `${unit}.socket`], signal);
		const disableService = await run("systemctl", ["--user", "disable", "--now", `${unit}.service`], signal);
		if (disableSocket.exitCode !== 0) {
			await run("systemctl", ["--user", "stop", `${unit}.socket`], signal);
		}
		if (disableService.exitCode !== 0) {
			await run("systemctl", ["--user", "stop", `${unit}.service`], signal);
		}
		stoppedCount += 1;
		if (disableSocket.exitCode === 0 || disableService.exitCode === 0) {
			disabledCount += 1;
			lines.push(`Disabled and stopped ${unit}`);
		} else {
			lines.push(`Stopped ${unit}`);
		}
	}

	if (manifestChanged && !dryRun) {
		saveManifest(manifest, manifestPath);
	}

	if (!dryRun) {
		await writeServiceHomeRuntime(join(os.homedir(), ".config", "bloom"), repoDir, signal);
	}

	const summary = [
		`Manifest apply complete (${dryRun ? "dry-run" : "live"}).`,
		`Installed: ${installedCount}`,
		`Started: ${startedCount}`,
		`Enabled persistently: ${enabledCount}`,
		`Stopped: ${stoppedCount}`,
		`Disabled persistently: ${disabledCount}`,
		`Errors: ${errors.length}`,
		"",
		...(lines.length > 0 ? ["Actions:", ...lines, ""] : []),
		...(errors.length > 0 ? ["Errors:", ...errors] : []),
	].join("\n");

	return {
		content: [{ type: "text" as const, text: truncate(summary) }],
		details: {
			installed: installedCount,
			started: startedCount,
			enabled: enabledCount,
			stopped: stoppedCount,
			disabled: disabledCount,
			errors,
			dryRun,
		},
		isError: errors.length > 0,
	};
}
