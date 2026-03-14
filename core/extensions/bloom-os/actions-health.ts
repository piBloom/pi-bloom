/**
 * System health handler for bloom-os.
 */
import { run } from "../../lib/exec.js";
import { truncate } from "../../lib/shared.js";

export async function handleSystemHealth(signal: AbortSignal | undefined) {
	const [bootc, ps, df, loadavg, meminfo, uptime] = await Promise.all([
		run("bootc", ["status", "--format=json"], signal),
		run("podman", ["ps", "--format", "json", "--filter", "name=bloom-"], signal),
		run("df", ["-h", "/", "/var", "/home"], signal),
		run("cat", ["/proc/loadavg"], signal),
		run("free", ["-h", "--si"], signal),
		run("uptime", ["-p"], signal),
	]);

	const sections: string[] = [];

	if (bootc.exitCode === 0) {
		try {
			const status = JSON.parse(bootc.stdout) as {
				status?: { booted?: { image?: { image?: { image?: string; version?: string } } } };
			};
			const img = status?.status?.booted?.image?.image;
			sections.push(`## OS Image\n- Image: ${img?.image ?? "unknown"}\n- Version: ${img?.version ?? "unknown"}`);
		} catch {
			sections.push(`## OS Image\n${bootc.stdout.slice(0, 200)}`);
		}
	} else {
		sections.push("## OS Image\n(bootc status unavailable)");
	}

	if (ps.exitCode === 0) {
		try {
			const containers = JSON.parse(ps.stdout || "[]") as Array<{
				Names?: string[];
				Status?: string;
				State?: string;
			}>;
			if (containers.length === 0) {
				sections.push("## Containers\nNo bloom-* containers running.");
			} else {
				const lines = containers.map((c) => {
					const name = (c.Names ?? []).join(", ") || "unknown";
					return `- ${name}: ${c.Status ?? c.State ?? "unknown"}`;
				});
				sections.push(`## Containers\n${lines.join("\n")}`);
			}
		} catch {
			sections.push("## Containers\n(parse error)");
		}
	}

	if (df.exitCode === 0) {
		sections.push(`## Disk Usage\n\`\`\`\n${df.stdout.trim()}\n\`\`\``);
	}

	const loadParts: string[] = [];
	if (loadavg.exitCode === 0) {
		const parts = loadavg.stdout.trim().split(/\s+/);
		loadParts.push(`Load: ${parts.slice(0, 3).join(" ")}`);
	}
	if (uptime.exitCode === 0) {
		loadParts.push(`Uptime: ${uptime.stdout.trim()}`);
	}
	if (meminfo.exitCode === 0) {
		const memLine = meminfo.stdout.split("\n").find((l) => l.startsWith("Mem:"));
		if (memLine) {
			const cols = memLine.split(/\s+/);
			loadParts.push(`Memory: ${cols[2] ?? "?"} used / ${cols[1] ?? "?"} total`);
		}
	}
	if (loadParts.length > 0) {
		sections.push(`## System\n${loadParts.map((l) => `- ${l}`).join("\n")}`);
	}

	const text = sections.join("\n\n");
	return { content: [{ type: "text" as const, text: truncate(text) }], details: {} };
}
