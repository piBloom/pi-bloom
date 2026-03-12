# Code Clarity Enforcer Memory

## Recurring Violations

- **Oversized files**: service-io.ts (272), netbird.ts (261), bloom-dev/index.ts (241), bloom-os/actions.ts (233).
- **High export count**: lib/netbird.ts has 13 exports, 6 of which are unused outside the file (internal-only).
- **Missing JSDoc**: 54 exported symbols across 13 files lack JSDoc (mostly actions handlers and daemon types).
- **Stale nginx references**: nginx removed from OS image but referenced in 7 living docs.

## Stale References (verified 2026-03-12, post-cleanup)

### Remaining:
- nginx references cleaned from living docs; remaining only in plan/spec docs (historical, acceptable)
- bloom.network refs remain only in docs/plans/ (immutable, acceptable)
- docs/quick_deploy.md:119-120 — Sway/Wayland references still present

### Fixed since last audit:
- AGENTS.md lib/nginx.ts reference: cleaned up (now shows netbird.ts)
- services/README.md services/examples/ reference: cleaned up
- bloom.network refs in living docs (CLAUDE.md, ARCHITECTURE.md, containers.md, services/README.md, bloom-services/index.ts): cleaned up
- Empty/stub types.ts files (bloom-setup, bloom-repo, bloom-objects, bloom-services): removed

## Dead Code (verified 2026-03-12)

- lib/netbird.ts: 6 exports never imported externally (NetBirdGroup, NetBirdZone, NetBirdRecord, DnsResult, netbirdEnvPath, zoneCachePath) — internal-only, should drop `export`
- 4 more exports (loadCachedZoneId, parseMeshIp, saveCachedZoneId) used only in tests — keep exported for testability
- lib/service-routing.ts: RoutingResult correctly non-exported (fixed since last audit)

## Security

- RESOLVED: os/bib-config.toml removed from tracking. Example file with placeholder. Gitignored.

## CI/Workflow Notes

- build-os.yml uses docker/login-action@v3 (no podman equivalent for GitHub Actions)
- Template files (services/_template/) use console.log instead of createLogger (known exception)

## Convention Edge Cases

- bloom-dev/index.ts (241 lines): pure wiring, 14 tool registrations. Not splittable without adding complexity.
- Cinny Quadlet uses PublishPort instead of Network=host — intentional but violates convention rule 10.
- Emojis in docs: sanctioned by docs/LEGEND.md as functional visual anchors.

## Resolved Issues

- lib/services.ts barrel: split into services-catalog, services-install, services-manifest, services-validation
- bloom-services/actions.ts (760 lines): split into actions-apply, actions-bridges, etc.
- bloom-display extension: removed entirely
- bloom-channels extension: removed entirely (replaced by pi-daemon)
- build-iso.sh shebang: fixed
- README.md: bloom-channels/unix socket refs cleaned up
- AGENTS.md: lib/nginx.ts ghost ref removed
- services/README.md: services/examples/ ref removed

## Complexity Hotspots

- actions-install.ts handleInstall() (153 lines): duplicates install logic in dependency loop. Extract installSingleService().
- service-io.ts installServicePackage() (91 lines): many operations but try/finally structured.

## Last Audit

- Date: 2026-03-12 (post 5618b39 cleanup)
- Files reviewed: 95 (excluding tests, node_modules, dist, .worktrees)
- Auto-fixes applied: 0 (report-only)
- Stale documentation: nginx ghost (7 files), quick_deploy Sway/Wayland (1 file)
- Dead code: 6 internal-only exports in lib/netbird.ts
- Missing JSDoc: 54 exports across 13 files
- Oversized files: 4 (service-io.ts, netbird.ts, bloom-dev/index.ts, bloom-os/actions.ts)
- Convention edge cases: 2 (bloom-dev/index.ts size, gateway PublishPort)
- Clean files: ~58
