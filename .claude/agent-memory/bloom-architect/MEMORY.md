# Bloom Architect Memory

## Architecture Decisions (Settled)

### Extension directory structure (2026-03-08)
- Every extension is a directory: `extensions/bloom-{name}/index.ts + actions.ts + types.ts`
- Always a directory, even for thin extensions -- consistency for AI-driven development
- `index.ts` is registration only, `actions.ts` handles orchestration, lib/ has pure logic
- 4 extensions MISSING types.ts (post-cleanup 2026-03-12): bloom-objects, bloom-repo, bloom-services, bloom-setup
- Tests live in `tests/` at project root (NOT colocated in extension dirs)

### lib/ actual files (2026-03-12, verified)
- `shared.ts` -- createLogger, nowIso, truncate, errorResult, guardBloom, requireConfirmation
- `exec.ts` -- run()
- `repo.ts` -- getRemoteUrl, inferRepoUrl
- `audit.ts` -- dayStamp, sanitize, summarizeInput, SENSITIVE_KEY
- `filesystem.ts` -- safePath, getBloomDir, getQuadletDir, getUpdateStatusPath (MISSING: getBloomRuntimeDir)
- `frontmatter.ts` -- parseFrontmatter, stringifyFrontmatter
- `git.ts` -- parseGithubSlugFromUrl, slugifyBranchPart
- `services-catalog.ts` -- loadServiceCatalog, loadBridgeCatalog, servicePreflightErrors, ServiceCatalogEntry
- (services-install.ts merged into services-catalog.ts in iteration 1)
- `services-manifest.ts` -- Manifest types, loadManifest, saveManifest
- `services-validation.ts` -- validateServiceName, validatePinnedImage, commandExists, hasSubidRange
- `matrix.ts` -- extractResponseText, generatePassword, matrixCredentialsPath, registerMatrixAccount
- `setup.ts` -- STEP_ORDER, advanceStep, getNextStep, etc.
- `gateway.ts` -- addGatewayRoute, generateCaddyfile, refreshGateway

### Service template (2026-03-08)
- `services/_template/` EXISTS
- No shared service library -- independence is the point

### OS-level infrastructure (2026-03-11)
- Matrix (Continuwuity), NetBird -- native systemd, not in catalog.yaml

## Architecture State (2026-03-12, full review)
- 9 extensions, 4 missing types.ts
- Container services: dufs, gateway, code-server; Bridges: whatsapp, telegram, signal
- Daemon: pi-daemon (matrix-listener, session-pool, room-registry)

## Known Issues (2026-03-12, iteration 2 review)
### Fixed in iteration 1
- installServicePackage temp dir indirection (FIXED)
- Bridge images :latest tags (FIXED -- pinned in catalog.yaml)
- services-install.ts merged into services-catalog.ts (FIXED)

### Remaining
- BIGGEST: bloom-dev and bloom-repo duplicate PR submission logic
- installServicePackage still has 2 unused params (_version, _entry)
- netbird.ts and service-routing.ts were deleted (moved to bash wizard)
- ~/.bloom runtime dir computed independently in 5 files
- handleSkillCreate hand-builds YAML (injection risk) -- stringifyFrontmatter already imported
- QUADLET_DIR eagerly computed at module level in actions-bridges.ts
- searchObjects scans entire ~ instead of ~/Bloom/Objects/
- handleInstall complexity=58: dependency loop duplicates primary install sequence
- handleManifestApply complexity=54: two separate loops over serviceEntries
- handleManifestSync unsafe type cast: `{ drifts } as unknown as Manifest`
- service-io.ts doesn't follow actions-{concern}.ts naming convention
- commandMissingError exported but only used internally by commandExists
- getPackageVersion in wrong file (actions.ts, only called from actions-blueprints.ts)

## Pi SDK Notes
- `StringEnum`, `Type`, `truncateHead` are VALUE exports -- peerDependency runtime imports correct
