import { defineConfig } from "vite";

export default defineConfig({
	root: "core/chat-server/frontend",
	build: {
		outDir: "../../../core/chat-server/frontend/dist",
		emptyOutDir: true,
	},
});
