import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["lib/**/*.ts", "extensions/**/*.ts"],
			thresholds: {
				"lib/**/*.ts": { lines: 60, functions: 80, branches: 55, statements: 60 },
				"extensions/**/*.ts": { lines: 20, functions: 25, branches: 10, statements: 20 },
			},
		},
	},
});
