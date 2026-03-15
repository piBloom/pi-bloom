import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary", "lcov"],
			reportsDirectory: "coverage",
			include: ["core/daemon/**/*.ts", "core/lib/**/*.ts", "core/pi-extensions/**/*.ts"],
			thresholds: {
				"core/daemon/**/*.ts": { lines: 30, functions: 35, branches: 22, statements: 30 },
				"core/lib/**/*.ts": { lines: 55, functions: 80, branches: 50, statements: 55 },
				"core/pi-extensions/**/*.ts": { lines: 20, functions: 25, branches: 12, statements: 20 },
			},
		},
	},
});
