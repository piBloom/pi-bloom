# ARCHITECTURE.md

Bloom's architectural rules. Enforced by humans, AI, and the bloom-architect agent. For build commands and workflow, see `CLAUDE.md`.

## Philosophy

**Containers first.** If it can be a container, it should be. Podman, Quadlet, and bootc's immutable model are the foundation. Don't reinvent what containers and systemd already solve.

**Pi-native.** Pi SDK is the integration layer. Extensions teach Pi about its host. Don't build custom agent infrastructure — use Pi's tools, hooks, events, and lifecycle.

**Lightest tier wins.** Skill before Extension before Service. Only escalate when the lighter tier genuinely can't solve the problem.

**Convention over cleverness.** Predictable patterns that AI and humans follow mechanically. One way to do things, always. No judgment calls about structure.

## Three-Tier Model

| Tier | What | When to use | Cost |
|------|------|-------------|------|
| **Skill** | Markdown procedures Pi reads and follows | Guidance, workflows, checklists | Zero — no code, no resources |
| **Extension** | In-process TypeScript registering tools/hooks | Pi-facing capabilities needing code | Low — runs in Pi's process |
| **Service** | Containerized workload (Podman Quadlet) | Independent processes, third-party software, heavy workloads | High — own container, own lifecycle |

## Extension Structure

Every extension is a directory. No exceptions, even for thin extensions.

```
extensions/bloom-{name}/
  index.ts       # export default function(pi) — registration ONLY
  actions.ts     # handler functions that call lib/ and format results
  types.ts       # extension-specific types (file optional, directory mandatory)
```

### Rules

1. **`index.ts` is wiring only.** It registers tools, hooks, and commands with the Pi SDK. Zero business logic. If a reviewer sees an `if` statement doing domain work, it belongs in `actions.ts` or `lib/`.
2. **`actions.ts` orchestrates.** It imports pure functions from `lib/`, calls them, and formats results for Pi. Side effects (fs, exec, net) happen here, not in `lib/`.
3. **`types.ts` defines interfaces.** Extension-specific types. Shared types go in `lib/`.
4. **Tests live in `tests/`.** Organized by type: `tests/extensions/`, `tests/lib/`, `tests/integration/`, `tests/e2e/`.

### Why

AI always knows the structure. Reviewers check one mechanical rule: "is there logic in `index.ts`?" No judgment calls about "is this extension big enough for a directory?"

## lib/ — Pure Logic by Capability

```
lib/
  shared.ts        # generic utilities (createLogger, nowIso, truncate, errorResult, guardBloom, requireConfirmation)
  frontmatter.ts   # parseFrontmatter, stringifyFrontmatter, yaml
  filesystem.ts    # safePath, getBloomDir
  exec.ts          # command execution (run)
  git.ts           # git utilities (parseGithubSlugFromUrl, slugifyBranchPart)
  repo.ts          # git remote helpers (getRemoteUrl, inferRepoUrl)
  audit.ts         # audit utilities (dayStamp, sanitize, summarizeInput)
  services-catalog.ts  # loadServiceCatalog, servicePreflightErrors
  services-install.ts  # findLocalServicePackage (pure lookup)
  services-manifest.ts # Manifest types, loadManifest, saveManifest
  services-validation.ts # validateServiceName, validatePinnedImage, commandExists
  lemonade.ts      # lemonade-server model catalog and HTTP pull helpers
  setup.ts         # first-boot setup wizard state machine (STEP_ORDER, advanceStep, getNextStep)
```

### Rules

1. **Every lib/ file is pure.** No side effects, no global state, no I/O at module level. Functions take inputs, return outputs.
2. **Named by capability, not consumer.** `lib/services.ts`, not `lib/bloom-services-helpers.ts`. Multiple extensions can import the same capability file.
3. **`shared.ts` is the last resort.** Only truly generic utilities (logging, timestamps, string truncation) belong here. If it relates to a specific capability, it has its own file.
4. **Testable without mocks.** Pure functions with injected dependencies. If you need to mock to test a lib/ function, the architecture is wrong.

### Why

Capability-based organization means logic lands in the right place from the start, no reshuffling when a second extension needs it. New capability files (e.g., `containers.ts`, `networking.ts`) are created when logic warrants extraction — don't create empty placeholder files.

## Service Structure

Services are scaffolded from a template and evolve independently. No shared service runtime library.

```
services/{name}/
  Containerfile              # build definition
  package.json               # dependencies, scripts
  src/
    index.ts                 # entry: health server, channel client, main loop
    transport.ts             # service-specific send/receive
    utils.ts                 # service-specific helpers
  tests/
    transport.test.ts
    utils.test.ts
  quadlet/
    bloom-{name}.container   # Quadlet unit, bloom.network, health check
```

### Rules

1. **Scaffold from template.** New services start from `services/_template/`. All current best practices are baked in.
2. **Independent after generation.** No shared runtime dependency. Each service owns its code completely.
3. **Template is source of truth.** Pattern improvements update the template. Backporting to existing services is deliberate and separate.
4. **Health checks required.** Every service must expose a health endpoint.
5. **bloom.network isolation.** Services bind to localhost or bloom.network, reachable only over NetBird mesh or local subnet.
6. **Quadlet naming.** `bloom-{name}` for the unit, consistent with all other services.

### Why

Services are containers — independence is the design. AI scaffolds from the template and focuses on service-specific logic. No coupling between services, no versioning headaches.

## Enforcement Checklist

Used by humans, AI, and the bloom-architect agent when reviewing code:

**Structure:**
- [ ] Extension is a directory with `index.ts`, `actions.ts`, `types.ts`
- [ ] `index.ts` contains only Pi SDK registration — no business logic
- [ ] Pure logic lives in the appropriate `lib/` capability file
- [ ] New service was scaffolded from the template

**Philosophy:**
- [ ] Uses containers/Quadlet instead of custom infrastructure where possible
- [ ] Uses Pi SDK patterns instead of custom agent infrastructure
- [ ] Chose the lightest tier that solves the problem
- [ ] Follows existing conventions — no novel patterns without discussion

**Quality:**
- [ ] TypeScript strict, ES2022, NodeNext
- [ ] Biome formatting (tabs, double quotes, 120 line width)
- [ ] Tests exist and pass (TDD: failing test first)
- [ ] lib/ functions are pure and testable without mocks
- [ ] Coverage thresholds maintained (lib/: 55% lines, 80% functions; extensions/: 15% lines, 20% functions)

**bootc:**
- [ ] No runtime system mutation — changes go through image builds
- [ ] Containerfile, not Dockerfile. podman, not docker.
- [ ] Services use Quadlet units with health checks
- [ ] Network isolation on bloom.network

**Pi SDK:**
- [ ] Pi SDK is a peerDependency — runtime VALUE imports (StringEnum, Type) are fine
- [ ] Extension follows `export default function(pi: ExtensionAPI)` pattern
- [ ] Skills have SKILL.md with proper frontmatter
