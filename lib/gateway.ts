/** Gateway route registry and Caddyfile generation. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { run } from "./exec.js";

export interface GatewayRoute {
	port: number;
	strip_prefix: boolean;
}

export interface GatewayRoutes {
	routes: Record<string, GatewayRoute>;
}

const GATEWAY_ROUTES_FILENAME = "gateway-routes.json";
const CADDYFILE_FILENAME = "Caddyfile";

function configDir(): string {
	return join(os.homedir(), ".config", "bloom");
}

/** Read the gateway route registry. Returns empty routes if file doesn't exist. */
export function readGatewayRoutes(): GatewayRoutes {
	const routesPath = join(configDir(), GATEWAY_ROUTES_FILENAME);
	if (!existsSync(routesPath)) {
		return { routes: {} };
	}
	try {
		return JSON.parse(readFileSync(routesPath, "utf-8"));
	} catch {
		return { routes: {} };
	}
}

/** Write the gateway route registry. */
export function writeGatewayRoutes(routes: GatewayRoutes): void {
	const routesPath = join(configDir(), GATEWAY_ROUTES_FILENAME);
	writeFileSync(routesPath, `${JSON.stringify(routes, null, "\t")}\n`);
}

/** Add a route to the registry. */
export function addGatewayRoute(path: string, port: number, stripPrefix: boolean): void {
	const routes = readGatewayRoutes();
	routes.routes[path] = { port, strip_prefix: stripPrefix };
	writeGatewayRoutes(routes);
}

/** Remove a route from the registry. */
export function removeGatewayRoute(path: string): void {
	const routes = readGatewayRoutes();
	delete routes.routes[path];
	writeGatewayRoutes(routes);
}

/** Generate a Caddyfile from the route registry. */
export function generateCaddyfile(routes: GatewayRoutes): string {
	const lines: string[] = [":18810 {"];

	// Proxy routes (registered services)
	for (const [path, route] of Object.entries(routes.routes)) {
		const directive = route.strip_prefix ? "handle_path" : "handle";
		lines.push(`\t${directive} ${path}/* {`);
		lines.push(`\t\treverse_proxy localhost:${route.port}`);
		lines.push("\t}");
		lines.push("");
	}

	// Well-known for Matrix client discovery (always present)
	lines.push("\thandle /.well-known/matrix/client {");
	lines.push("\t\theader Content-Type application/json");
	lines.push('\t\trespond `{"m.homeserver": {"base_url": "/"}}` 200');
	lines.push("\t}");
	lines.push("");

	// Default: Cinny web client (always present)
	lines.push("\thandle {");
	lines.push("\t\troot * /srv/cinny");
	lines.push("\t\tfile_server");
	lines.push("\t\ttry_files {path} /index.html");
	lines.push("\t}");
	lines.push("}");
	lines.push("");

	return lines.join("\n");
}

/** Write the generated Caddyfile to ~/.config/bloom/Caddyfile. */
export function writeCaddyfile(routes: GatewayRoutes): void {
	const caddyfilePath = join(configDir(), CADDYFILE_FILENAME);
	writeFileSync(caddyfilePath, generateCaddyfile(routes));
}

/** Regenerate the Caddyfile from the route registry and restart the gateway. */
export async function refreshGateway(signal?: AbortSignal): Promise<void> {
	const routes = readGatewayRoutes();
	writeCaddyfile(routes);
	await run("systemctl", ["--user", "restart", "bloom-gateway.service"], signal);
}
