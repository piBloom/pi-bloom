import { defineConfig } from "vitepress";

export default defineConfig({
	title: "NixPI",
	description: "Pi-native AI companion OS on NixOS",
	base: "/NixPI/",
	lang: "en-US",
	appearance: false,
	cleanUrls: true,
	lastUpdated: true,
	ignoreDeadLinks: false,

	themeConfig: {
		nav: [
			{ text: "Overview", link: "/" },
			{ text: "Why NixPI", link: "/why-nixpi" },
			{ text: "Install", link: "/install" },
			{ text: "Getting Started", link: "/getting-started/" },
			{ text: "Operations", link: "/operations/" },
			{ text: "Architecture", link: "/architecture/" },
			{ text: "Reference", link: "/reference/" },
			{ text: "GitHub", link: "https://github.com/alexradunet/NixPI" },
		],

		sidebar: {
			"/": [
				{
					text: "Start Here",
					items: [
						{ text: "Overview", link: "/" },
						{ text: "Why NixPI", link: "/why-nixpi" },
						{ text: "Install", link: "/install" },
						{ text: "Getting Started", link: "/getting-started/" },
						{ text: "Operations", link: "/operations/" },
						{ text: "Architecture", link: "/architecture/" },
						{ text: "Reference", link: "/reference/" },
					],
				},
			],

			"/getting-started/": [
				{
					text: "Getting Started",
					items: [{ text: "Overview", link: "/getting-started/" }],
				},
			],

			"/architecture/": [
				{
					text: "Architecture",
					items: [
						{ text: "Overview", link: "/architecture/" },
						{ text: "Runtime Flows", link: "/architecture/runtime-flows" },
					],
				},
			],

			"/operations/": [
				{
					text: "Operations",
					items: [
						{ text: "Overview", link: "/operations/" },
						{ text: "Quick Deploy", link: "/operations/quick-deploy" },
						{ text: "First Boot Setup", link: "/operations/first-boot-setup" },
						{ text: "Live Testing", link: "/operations/live-testing" },
					],
				},
			],

			"/reference/": [
				{
					text: "Reference",
					items: [
						{ text: "Overview", link: "/reference/" },
						{ text: "Service Architecture", link: "/reference/service-architecture" },
						{ text: "Daemon Architecture", link: "/reference/daemon-architecture" },
						{ text: "Memory Model", link: "/reference/memory-model" },
						{ text: "Security Model", link: "/reference/security-model" },
						{ text: "Supply Chain", link: "/reference/supply-chain" },
						{ text: "Infrastructure", link: "/reference/infrastructure" },
					],
				},
			],
		},

		socialLinks: [
			{ icon: "github", link: "https://github.com/alexradunet/NixPI" },
		],

		editLink: {
			pattern: "https://github.com/alexradunet/NixPI/edit/main/docs/:path",
			text: "Edit this page on GitHub",
		},

		footer: {
			message: "Released under the MIT License.",
			copyright: "Copyright © 2024-present NixPI contributors",
		},

		search: {
			provider: "local",
		},
	},
});
