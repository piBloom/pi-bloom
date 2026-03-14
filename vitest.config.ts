import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["core/lib/**/*.ts", "core/extensions/**/*.ts", "extensions/**/*.ts"],
			thresholds: {
				"core/lib/**/*.ts": { lines: 55, functions: 80, branches: 50, statements: 55 },
				"core/extensions/**/*.ts": { lines: 15, functions: 20, branches: 8, statements: 15 },
				"extensions/**/*.ts": { lines: 15, functions: 20, branches: 8, statements: 15 },
			},
		},
	},
});
