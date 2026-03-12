import { describe, expect, it } from "vitest";
import { type GatewayRoutes, generateCaddyfile } from "../../lib/gateway.js";

describe("generateCaddyfile", () => {
	it("generates Caddyfile with no proxy routes", () => {
		const routes: GatewayRoutes = { routes: {} };
		const result = generateCaddyfile(routes);
		expect(result).toContain(":18810 {");
		expect(result).toContain("/.well-known/matrix/client");
		expect(result).toContain("/srv/cinny");
		expect(result).not.toContain("reverse_proxy");
	});

	it("generates handle block for non-stripping route", () => {
		const routes: GatewayRoutes = {
			routes: {
				"/_matrix": { port: 6167, strip_prefix: false },
			},
		};
		const result = generateCaddyfile(routes);
		expect(result).toContain("handle /_matrix/*");
		expect(result).toContain("reverse_proxy localhost:6167");
		expect(result).not.toContain("handle_path /_matrix/*");
	});

	it("generates handle_path block for stripping route", () => {
		const routes: GatewayRoutes = {
			routes: {
				"/webdav": { port: 5000, strip_prefix: true },
			},
		};
		const result = generateCaddyfile(routes);
		expect(result).toContain("handle_path /webdav/*");
		expect(result).toContain("reverse_proxy localhost:5000");
	});

	it("generates multiple routes", () => {
		const routes: GatewayRoutes = {
			routes: {
				"/_matrix": { port: 6167, strip_prefix: false },
				"/webdav": { port: 5000, strip_prefix: true },
				"/code": { port: 8443, strip_prefix: true },
			},
		};
		const result = generateCaddyfile(routes);
		expect(result).toContain("handle /_matrix/*");
		expect(result).toContain("handle_path /webdav/*");
		expect(result).toContain("handle_path /code/*");
		expect(result).toContain("localhost:8443");
	});

	it("always includes well-known and Cinny fallback", () => {
		const routes: GatewayRoutes = {
			routes: {
				"/_matrix": { port: 6167, strip_prefix: false },
			},
		};
		const result = generateCaddyfile(routes);
		expect(result).toContain("/.well-known/matrix/client");
		expect(result).toContain("try_files {path} /index.html");
	});
});
