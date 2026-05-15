.PHONY: dev start smoke check build

dev:
	bun --watch server.js

start:
	bun server.js

smoke:
	NIXPI_SERVER_RUNTIME=bun NIXPI_SERVER_ENTRY=server.js bun scripts/smoke-ui.js

check:
	node --check server.js
	node --check public/app.js
	node --check public/ds/topbar-actions.js
	node --check scripts/smoke-ui.js
	$(MAKE) smoke
	nix flake check --no-build

build:
	nix build .#nixpi-bun --no-link
