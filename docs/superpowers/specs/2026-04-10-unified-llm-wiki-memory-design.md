# Unified LLM Wiki Memory for NixPI

Date: 2026-04-10
Status: proposed
Owner: Pi / NixPI

## Summary

Replace NixPI’s current long-term memory architecture (`Episodes/`, `Objects/`, and evolution objects) with a single unified, page-first wiki under `~/nixpi/Wiki/`.

In the new model:

- **everything can be a source**
- **wiki pages are the canonical long-term truth**
- **strict provenance is required for important factual claims**
- **self-evolution lives inside the same wiki**
- **generated metadata replaces ad hoc indexing/logging**
- **the old object-store and episode model are retired, not preserved as the primary abstraction**

This is a clean-break redesign, implemented in phases so the new subsystem can be built and validated before historical data is migrated.

## Problem

NixPI’s current memory model is intentionally simple and file-based:

- `~/nixpi/Episodes/` stores append-only episodic observations
- `~/nixpi/Objects/` stores durable promoted objects
- self-evolution is tracked as a specialized object/process

That model is good at lightweight capture and durable storage, but it is too thin for a compounding knowledge system.

Current gaps:

- no immutable raw source packet model
- no source-page boundary between evidence and belief
- no canonical concept/entity/synthesis pages
- no strong citation discipline for durable knowledge
- no generated backlinks/registry/index/log/lint layer
- no natural place to file durable analyses back into memory
- no single architecture spanning personal memory, research, project knowledge, and self-evolution

The result is that long-term knowledge is durable but not deeply integrated. NixPI can remember specific objects, but it cannot maintain a true evolving wiki of what it currently believes.

## Goals

- Replace the current memory system with a **single unified wiki**.
- Make **canonical pages** the primary long-term knowledge representation.
- Treat **everything as an eligible source type by default**: chat, user statements, tool output, files, URLs, plans, analyses, and imported documents.
- Enforce **strict provenance** for important factual claims.
- Fold **self-evolution** into the same knowledge system.
- Keep the implementation **markdown-native, inspectable, local-first, and simple**.
- Provide a **Pi extension** with deterministic tools and guardrails.
- Make the wiki **Obsidian-friendly** and practical to browse/edit directly.

## Non-Goals

- introducing SQLite or a vector database as canonical storage
- making embeddings required for retrieval
- replacing markdown pages with a structured claim database
- preserving `memory_*` or `episode_*` as permanent first-class abstractions
- treating every conversation turn or raw artifact as automatic canonical truth without source discipline
- turning NixPI into a hidden backend system that only incidentally writes markdown

## Design Decision

### Recommended approach

Use a **page-first unified wiki** as NixPI’s canonical long-term memory system.

This was chosen over:

1. **Sidecar wiki beside existing memory**
   - rejected because it creates two competing truths and duplicates concepts
2. **Structured claim/object core with generated wiki views**
   - rejected because it increases complexity and moves away from a human-readable markdown-native system

The recommended approach is simpler, more aligned with NixPI’s file-based philosophy, and better matched to the LLM-wiki pattern.

## Architecture

The canonical long-term memory root becomes:

```text
~/nixpi/Wiki/
├─ raw/
│  └─ packets/
│     └─ SRC-YYYY-MM-DD-NNN/
│        ├─ manifest.json
│        ├─ original/
│        ├─ extracted.md
│        └─ attachments/
├─ pages/
│  ├─ sources/
│  ├─ people/
│  ├─ projects/
│  ├─ concepts/
│  ├─ procedures/
│  ├─ decisions/
│  ├─ evolutions/
│  ├─ syntheses/
│  ├─ analyses/
│  └─ system/
├─ meta/
│  ├─ registry.json
│  ├─ backlinks.json
│  ├─ index.md
│  ├─ events.jsonl
│  ├─ log.md
│  └─ lint-report.md
├─ .wiki/
│  ├─ config.json
│  └─ templates/
└─ WIKI_SCHEMA.md
```

### Layer responsibilities

#### `raw/packets/`

Immutable source-of-truth input packets.

Examples of capturable source kinds:

- user statements
- chat segments
- tool results
- pasted notes
- local files
- URLs/articles
- PDFs/images/documents
- generated plans/reports/analyses

#### `pages/sources/`

One page per source packet, answering: **what does this source say?**

#### Other `pages/**`

Canonical pages, answering: **what does NixPI currently believe?**

#### `meta/`

Generated navigation and health artifacts.

#### `WIKI_SCHEMA.md`

The operating manual for the model and the human. Defines page shapes, workflows, evidence rules, and maintenance rules.

## Data Model

### Source packets

Source packets replace episodes as the primary append-only capture model.

Anything may be captured as a source type, but capture eligibility does not imply automatic integration into canonical pages. Broad capture is allowed; durable synthesis remains selective and citation-driven.

Each packet gets a stable ID such as:

```text
SRC-2026-04-10-001
```

Each packet should include a manifest with at least:

- `id`
- `kind`
- `created`
- `title`
- `captured_by`
- `source_uri` or source path when relevant
- `content_hash`
- `scope`
- `tags`
- `related_packets`
- `immutability: true`

Source kinds may include:

- `chat`
- `user-statement`
- `tool-result`
- `url`
- `file`
- `pdf`
- `image`
- `pasted-note`
- `generated-analysis`
- `migration-legacy-episode`
- `migration-legacy-object`

Source packets are immutable after capture.

### Source pages

Every packet gets a source page at:

```text
pages/sources/SRC-YYYY-MM-DD-NNN.md
```

Recommended frontmatter:

- `type: source`
- `source_id`
- `source_kind`
- `status: captured | integrated | superseded`
- `created`
- `modified`
- `tags`

Recommended body sections:

- `## Summary`
- `## Key claims`
- `## Entities / concepts touched`
- `## Contradictions / tensions`
- `## Integration notes`

Source pages are the citation target for canonical pages. Canonical pages should cite source page IDs, not raw packet files.

### Canonical pages

Canonical pages replace durable objects as the primary long-term truth representation.

Examples:

- `pages/people/alex.md`
- `pages/projects/nixpi.md`
- `pages/procedures/recover-chat-runtime.md`
- `pages/decisions/page-first-memory-model.md`
- `pages/evolutions/unified-llm-wiki-memory.md`
- `pages/concepts/episodic-vs-canonical-memory.md`

Recommended frontmatter:

- `type`
- `slug`
- `title`
- `status`
- `scope`
- `tags`
- `created`
- `modified`
- `aliases`
- `source_ids`
- optional `salience`
- optional `evidence_strength: weak | moderate | strong`

Required or near-required body sections for most canonical pages:

- `## Current understanding`
- `## Evidence`
- `## Tensions / caveats`
- `## Open questions`
- `## Related`

Specialized required sections by page type:

#### Procedures

- `## Preconditions`
- `## Steps`
- `## Verification`
- `## Failure modes`

#### Decisions

- `## Decision`
- `## Why`
- `## Alternatives considered`
- `## Consequences`

#### Evolutions

- `## Problem`
- `## Proposal`
- `## Plan`
- `## Validation`
- `## Status`

#### People / projects / system pages

- `## Current understanding`
- `## Key details`
- `## Evidence`
- `## Tensions / caveats`
- `## Related`

### Analysis pages

Durable answers to user questions should be fileable as first-class pages under:

```text
pages/analyses/
```

These are derived artifacts, not raw evidence and not core entity pages. They should cite canonical pages and/or source pages.

Examples:

- a comparison
- a timeline summary
- a thesis across several sources
- a reflective summary about user behavior or project direction

### Evolution pages

Self-evolution becomes a normal canonical page type under:

```text
pages/evolutions/
```

Each evolution page should capture:

- the problem or capability gap
- motivation and evidence
- options considered
- chosen direction
- implementation plan references
- validation notes
- status

Suggested statuses:

- `proposed`
- `approved`
- `implementing`
- `reviewing`
- `applied`
- `rejected`
- `superseded`

## Retrieval Model

Retrieval is page-first.

Recommended query order:

1. read `meta/index.md` or use `wiki_search`
2. identify relevant canonical pages
3. read canonical pages
4. drill into source pages when needed
5. inspect raw packets only when necessary

Normal path:

```text
index/registry -> canonical pages -> source pages -> raw packets
```

### Retrieval principles

- canonical pages are the first retrieval target
- source pages provide supporting evidence and detail
- raw packets are fallback evidence, not default reading material
- retrieval should remain embedding-free by default in v1

## Provenance Model

NixPI v2 uses strict provenance for important factual claims.

### Rule

Important factual claims on canonical pages must cite source page IDs, for example:

```md
[[sources/SRC-2026-04-10-001|SRC-2026-04-10-001]]
```

### Evidence chain

```text
raw packet -> source page -> canonical page -> analysis page
```

### Important factual claim categories

At minimum, provenance is required for:

- user identity and preference claims
- system state and operational facts
- project decisions
- procedures
- historical claims
- causal or comparative synthesis claims
- self-model claims about the user

### Allowed uncited content

Allowed without citation:

- headings
- transition prose
- explicitly marked hypotheses
- open questions
- stylistic glue text

Not allowed without citation:

- durable factual assertions presented as current understanding

### Contradictions and tensions

Conflicts between new evidence and old synthesis should be recorded explicitly in:

- `## Tensions / caveats`
- related decision pages
- related synthesis pages when the disagreement spans multiple sources or topics

The system should prefer explicit unresolved tension over silent overwrite.

## Tool and Extension Design

A new `wiki` extension replaces the current `objects` and `episodes` extensions as the canonical long-term memory subsystem.

### Extension responsibility split

Extension tools handle deterministic operations:

- vault/bootstrap management
- source capture
- page resolution and safe creation
- metadata rebuild
- lint
- event logging
- status

Pi’s built-in read/edit/write tools continue to author and update `pages/**`.

A bundled wiki-maintenance skill teaches the model how to:

- capture first, integrate second
- cite evidence correctly
- search before creating pages
- update canonical pages rather than scattering duplicates
- use lint and metadata consistently

### Proposed tool surface

#### Setup

- `wiki_bootstrap`
- `wiki_status`
- `wiki_rebuild_meta`

#### Capture

- `wiki_capture_source`

#### Canonical page resolution

- `wiki_resolve_page`
- `wiki_ensure_page`

#### Search and retrieval

- `wiki_search`

#### Logging and metadata

- `wiki_log_event`
- `wiki_rebuild_meta`

#### Quality

- `wiki_lint`

#### Optional later tools

- `wiki_move_page`
- `wiki_merge_pages`
- `wiki_file_analysis`

### Replaced tools

The following tools are retired as primary abstractions:

- `memory_create`
- `memory_update`
- `memory_upsert`
- `memory_read`
- `memory_query`
- `memory_search`
- `memory_link`
- `memory_list`
- `episode_create`
- `episode_list`
- `episode_promote`
- `episode_consolidate`

Some helper logic may be reused internally, but the conceptual model changes completely.

## User Workflows

### Ingest flow

1. capture source with `wiki_capture_source`
2. inspect generated source page
3. search for impacted canonical pages with `wiki_search` or `wiki_resolve_page`
4. create missing pages with `wiki_ensure_page`
5. update canonical pages with citations
6. record integration via `wiki_log_event`

### Query flow

1. search wiki metadata and canonical pages
2. read relevant pages
3. synthesize answer with citations
4. optionally file answer into `pages/analyses/`
5. log durable query/analysis events when appropriate

### Lint flow

1. run `wiki_lint`
2. summarize structural and evidence issues
3. fix deterministic issues where safe
4. log lint event

### Evolution flow

1. resolve or create an evolution page under `pages/evolutions/`
2. cite motivating sources
3. link related decisions, procedures, projects, or concepts
4. update status over time
5. log evolution-related events

## Guardrails

### Machine-owned paths

Pi should not directly edit:

- `raw/**`
- `meta/registry.json`
- `meta/backlinks.json`
- `meta/events.jsonl`
- `meta/index.md`
- `meta/log.md`
- `meta/lint-report.md`

These are extension-owned or generated artifacts.

### Editable knowledge space

Pi may author and maintain:

- `pages/**`
- `WIKI_SCHEMA.md` only on explicit request

### Behavioral guardrails

- capture first, integrate second
- canonical pages cite source pages, not raw packet files
- canonical pages do not absorb important facts without provenance
- generated metadata is rebuilt after relevant page edits
- user overrides remain allowed, but Pi defaults to disciplined maintenance behavior

## Lint Model

Lint is split into deterministic mechanical checks and rule-based knowledge hygiene checks.

### Mechanical lint

Deterministic checks should include:

- broken wikilinks
- duplicate titles
- duplicate aliases
- missing required frontmatter
- missing required sections for page type
- orphan canonical pages
- source pages with no inbound citations
- source pages still marked `captured` and not `integrated`
- near-empty canonical pages
- slug/title mismatches if naming rules require it
- metadata drift requiring rebuild

### Knowledge hygiene lint

Rule-based checks should include:

- factual sections with no source citations
- contradictions across canonical pages
- speculative language outside `Open questions`
- pages with too many uncited assertions
- pages large enough to justify splitting
- repeatedly mentioned concepts/entities lacking their own page
- stale or superseded evidence that has not been reflected in synthesis
- evolution pages stalled in intermediate states for too long

## Logging Model

Chronological memory is represented by:

- `meta/events.jsonl` — append-only structured machine log
- `meta/log.md` — generated human-readable timeline

Suggested event kinds:

- `capture`
- `integrate`
- `page-create`
- `page-update`
- `query`
- `analysis-filed`
- `lint`
- `decision-update`
- `evolution-update`
- `migration`

## Migration Strategy

Architecturally this is a clean break. Operationally it should be phased.

### Data migration stance

Historical data should be migrated into the new system, but the old storage model should not remain primary.

### Legacy episode migration

Each existing episode becomes a source packet plus a generated source page.

Suggested migrated source kinds:

- `migration-legacy-episode-observation`
- `migration-legacy-episode-decision-point`
- `migration-legacy-episode-tool-result`

Existing `derived_objects` become migration hints or backlinks.

### Legacy object migration

Existing objects become canonical pages or are merged into richer canonical pages.

Examples:

- `procedure` -> `pages/procedures/`
- `decision` -> `pages/decisions/`
- `project` -> `pages/projects/`
- `evolution` -> `pages/evolutions/`
- fragmented personal preferences/facts -> likely merged into `pages/people/operator.md` or another related canonical page

Migration should not naively preserve one-object-to-one-page when richer consolidation is clearly better.

### Legacy evolution migration

Existing evolutions become evolution pages with status/history retained where possible.

## Implementation Phases

### Phase 1 — Scaffold the wiki subsystem

Deliver:

- `core/pi/extensions/wiki/`
- `wiki_bootstrap`
- `wiki_status`
- `wiki_rebuild_meta`
- vault structure
- templates and schema
- initial meta generation
- new documentation skeleton

### Phase 2 — Source capture and source-page pipeline

Deliver:

- `wiki_capture_source`
- packet manifest format
- source ID generation
- source-page generation
- append-only event log
- generated log page

### Phase 3 — Canonical page management and search

Deliver:

- `wiki_search`
- `wiki_resolve_page`
- `wiki_ensure_page`
- registry/backlink generation
- page templates
- auto meta rebuild after page edits

### Phase 4 — Lint and provenance enforcement

Deliver:

- `wiki_lint`
- uncited-claim detection
- orphan detection
- stale/unintegrated source detection
- contradiction/tension checks
- required-section validation
- machine-owned path guardrails

### Phase 5 — Historical data migration

Deliver:

- migration script(s)
- episode -> packet + source page migration
- object -> canonical page migration
- evolution -> evolution page migration
- migration event logging
- migration report with ambiguous mappings, duplicates, and failures

### Phase 6 — Remove old APIs and update skills/persona/docs

Deliver:

- remove or deprecate `objects` and `episodes` extensions
- replace object-store guidance with wiki-maintenance guidance
- update persona language from objects/episodes to wiki memory
- update memory docs and tests
- update self-evolution instructions to use evolution pages in the wiki

## Error Handling and Failure Modes

### Page sprawl

Risk: over-eager page creation produces clutter.

Mitigation:

- resolve before create
- lint for sparse/orphan pages
- prefer enriching existing pages over creating near-duplicates

### Citation fatigue

Risk: provenance requirements make pages awkward or brittle.

Mitigation:

- enforce citation primarily for important factual claims
- require `Evidence` sections
- make lint helpful rather than perfectionist

### Migration ambiguity

Risk: legacy objects do not map cleanly.

Mitigation:

- produce reviewable migration reports
- preserve source provenance during migration
- log migration steps explicitly

### Over-engineering

Risk: the wiki subsystem becomes too tool-heavy.

Mitigation:

- keep v1 markdown-native
- no vector DB
- no structured claim engine as canonical truth
- deterministic extension + page authoring only

### Overformalizing personal data

Risk: because everything is capturable, Pi may overstate fleeting user behavior.

Mitigation:

- broad capture is acceptable
- selective integration into canonical pages is required
- self-model pages must represent uncertainty and tensions explicitly

## Testing Strategy

### Unit tests

- source ID generation
- safe path resolution
- manifest creation
- metadata rebuild logic
- registry/backlink generation
- lint rule behavior
- page resolution rules
- migration mapping helpers

### Integration tests

- capture source -> source page created -> event logged
- update canonical pages -> metadata rebuilt
- search returns expected pages
- lint catches uncited/faulty pages
- migration works on representative fixtures

### End-to-end tests

- bootstrap a new wiki
- capture several sources
- integrate into canonical pages
- file an analysis page
- run lint and rebuild
- verify final filesystem and metadata state

### Testing principle

Do not test freeform prose quality as the primary success condition. Test deterministic rails, metadata, guardrails, and filesystem outcomes.

## Impact on NixPI Skills and Persona

### Persona changes

The persona and reference docs must stop describing long-term memory as an object store plus episodes. They should describe NixPI as maintaining a unified markdown wiki.

### Skill changes

- replace `object-store` skill with a `wiki-maintenance` skill
- update `self-evolution` skill so evolution work is represented as wiki pages
- update any built-in flows that mention episodes or durable object promotion

## Recommendation

Adopt the page-first unified wiki design as the new canonical long-term memory system for NixPI.

This is the simplest design that:

- preserves markdown-first inspectability
- supports compounding synthesis over time
- enforces provenance
- unifies personal, project, research, and system knowledge
- absorbs self-evolution into the same substrate
- aligns with Pi-native extension design

## Implementation Readiness

This design is specific enough to move into implementation planning.

The next step should be a written implementation plan that breaks the work into repository changes, tool contracts, migration steps, tests, and review checkpoints.