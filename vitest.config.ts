import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
		clearMocks: true,
		restoreMocks: true,
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary", "lcov"],
			reportsDirectory: "coverage",
			include: ["core/daemon/**/*.ts", "core/lib/**/*.ts", "core/pi-extensions/**/*.ts"],
			thresholds: {
				"core/daemon/**/*.ts": { lines: 85, functions: 80, branches: 75, statements: 85 },
				"core/lib/**/*.ts": { lines: 71, functions: 76, branches: 57, statements: 67 },
				"core/pi-extensions/**/*.ts": { lines: 60, functions: 60, branches: 50, statements: 60 },
			},
		},
	},
});
