# Landscape: similar projects and what to learn from them

Research date: 2026-10-27. Vendor claims are marked as such. Star counts and
pricing change often, so check before you rely on them.

---

## 1. Summary

Many tools do **one part** of what ArchitectureGuide plans to do. None of the
tools found does all of it:

| Capability | Who does it today |
|---|---|
| Semantic model with separate views (C4) | Structurizr, LikeC4, IcePanel, Ilograph |
| Drag-and-drop for mixed teams | IcePanel, Cloudcraft, Excalidraw, Lucid |
| Repo → diagram with AI | GitDiagram, Eraser, Archaic, repo-cartographer, Swark |
| Rules on real code (import boundaries) | dependency-cruiser, ArchUnitTS, Nx module boundaries |
| Specs for AI agents | Kiro, GitHub Spec Kit |
| Architecture from runtime data | Multiplayer (OpenTelemetry), Cloudcraft (cloud accounts) |
| Visual model → generated backend code | Amplication (NestJS + Prisma) |

**The gap:** no tool found combines a visual, semantic canvas, **stack-aware
anti-pattern rules**, a two-way agent loop (MCP), and enforcement of the
design on the real code. Most "AI diagram" tools produce a one-shot picture
(usually Mermaid). The result is not an editable model, and nothing checks it.

**Positioning for ArchitectureGuide:** "an architecture linter with a canvas,
for React + Node.js + PostgreSQL, connected to your coding agent."

---

## 2. Projects by category

### 2.1 Architecture-as-code (C4 family)

**Structurizr** ([docs](https://docs.structurizr.com/ai), [MCP](https://docs.structurizr.com/ai/mcp))
- Text DSL for C4 models. One model, many views. Open source.
- Has an official MCP server: DSL validation, parsing, inspections, export to
  Mermaid / PlantUML. A public instance runs at `mcp.structurizr.com`.
- Important finding from its author: agents **often need several correction
  rounds to write valid DSL** (nesting, syntax). Agents improved when the
  parser returned clear errors.
- **Lesson:** do not make the agent write a DSL. Give it **structured JSON
  tools** (`upsert_elements`) that validate each item, and return precise
  errors and rule findings in every response. Offer Structurizr DSL as an
  *export* only.

**LikeC4** ([docs](https://likec4-docs-astro.pages.dev/), [MCP](https://likec4-docs-astro.pages.dev/tooling/mcp), [GitHub](https://github.com/likec4/likec4))
- Inspired by C4 and Structurizr. Supports custom element kinds, notation and
  nesting levels. This is close to our concept catalog.
- Has an MCP server (`@likec4/mcp`, stdio or HTTP) to query the model in natural
  language.
- **Lesson:** custom element kinds are the right approach. Add LikeC4 export so
  users can move between the tools.

**Ilograph** ([example](https://gtrunsec.github.io/Diagrams-as-Code/posts/ilograph), [MCP](https://mcp.so/server/ilograph-mcp-server/QuincyMillerDev))
- YAML model with resources, "perspectives" (views) and relations.
- A community MCP server generates `.ilograph` files from Python / JS / TS / Java code.
- **Lesson:** "perspectives" confirm the model/view split.

### 2.2 Visual / drag-and-drop modelling

**IcePanel** ([vs Structurizr](https://icepanel.io/blog/2025-11-14-icepanel-vs-structurizr), [2026 tools overview](https://icepanel.io/blog/best-collaborative-software-architecture-diagramming-tools-2026))
- Cloud-based C4 modelling with drag-and-drop, for technical and
  non-technical people. The vendor says it covers C4 levels 1–3.
- Vendor-stated pricing (January 2026): free for 1–5 editors, then $40 and
  $80 per editor per month.
- IcePanel itself says Structurizr is the better fit when diagrams as code
  matter more than ease of use (vendor source).
- **Lesson:** the UX bar for "simple to use" is IcePanel. Reusable model
  objects and "flows" (our *scenarios*) work well. Our difference: rules,
  agent loop, local-first and git files.

**Cloudcraft** ([site](https://cloudcraft.co/), [Datadog](https://datadoghq.com/ja/product/cloudcraft))
- AWS/Azure diagrams created from live cloud inventory. Version history,
  multi-user editing.
- **Lesson:** "import from reality, then refresh" is valuable. For us, reality
  is the repo (and later, traces).

**Excalidraw MCP servers** ([mcp_excalidraw](https://mcpservers.org/servers/yctimlin/mcp_excalidraw), [excalidraw-mcp-server](https://awesome.ecosyste.ms/projects/github.com%2Ffromsko%2Fexcalidraw-mcp-server))
- Community projects: a canvas server plus an MCP server, so an agent draws on
  a live canvas in the browser. One also ships an agent *skill* as an
  alternative to MCP. The projects report their own stability issues.
- **Lesson:** confirms our `archguide serve` + live reload design. Also ship a
  **Claude Code skill** next to the MCP server.

### 2.3 AI: repository → diagram

**GitDiagram** ([GitHub](https://github.com/martin226/gitdiagram), [AlternativeTo](https://alternativeto.net/software/gitdiagram/about))
- Open source (MIT). Reads the file tree and README, then an LLM produces a
  Mermaid diagram. Click a component to open its files. Popular (about 15k
  stars on AlternativeTo, which may be out of date).
- Limits: it is based on the file tree and README, not on code semantics. The
  output is a picture, not a model. It has no rules.
- **Lesson:** "click to open the code" is a must. We have it through
  `evidence` / `codePaths`.

**Eraser** ([codebase diagrams](https://docs.eraser.io/docs/codebase-diagrams), [agent integrations](https://docs.eraser.io/docs/using-ai-agent-integrations))
- Prompt + connected repo → AI diagram, stored as diagram-as-code.
- **Eraserbot**: a CI integration that keeps diagrams up to date when code changes.
- Supports Claude Code and Cursor through MCP or Agent Skills.
- **Lesson:** keeping diagrams current in CI is now expected. Our `archguide
  drift` + GitHub Action covers this. We also *enforce* the design, which
  Eraser does not.

**Archaic** ([MCP](https://glama.ai/mcp/servers/archaic-ai/archaic-mcp))
- Desktop app that analyzes a codebase into interactive diagrams. Its MCP server
  lets Claude Code read the architecture and push updates back.
- **Lesson:** this is the closest to our two-way loop. Our difference: no
  desktop app needed, git files, stack-specific rules.

**repo-cartographer** ([listing](https://enterprisedna.co/directories/mcp/builditwithgk-repo-cartographer))
- Repo → Mermaid/Graphviz, plus architecture rules in CI. Runs as MCP server,
  CLI and GitHub Action. Very early (1 star).
- **Lesson:** others see the same idea (MCP + CLI + Action). The market is still
  open, and execution quality will decide.

**Other MCP diagram servers**: mermaid-mcp-server (code → Mermaid through
Kroki), Blueprint MCP (needs a third-party platform), DiagramMCP (no code
analysis). ([overview](https://enterprisedna.co/directories/mcp/gittyburstein-mermaid-mcp-server), [Blueprint](https://www.scriptbyai.com/blueprint-mcp), [DiagramMCP](https://glama.ai/mcp/servers/@LelonDelonMelon/diagramMCP/tree/a2f22b54361bfe09b5adf5e01885e2b4885dbd78))

**CodeSee** (codebase maps), cautionary. Sources conflict: one aggregator
says it shut down in 2024 after it could not convert free users to paid users
([loot-drop](https://www.loot-drop.io/startup/2500-codesee)). CB Insights
lists an acquisition by GitKraken in May 2024
([CB Insights](https://www.cbinsights.com/compare/codesee-vs-github)).
- **Lesson (careful):** code visualization alone was hard to sustain. The
  value must come from the workflow (planning features, agent context, CI
  enforcement), not from the picture.

### 2.4 Rules on real code (Node / TypeScript)

**dependency-cruiser** ([GitHub](https://github.com/sverweij/dependency-cruiser), [README](https://cdn.jsdelivr.net/npm/dependency-cruiser@17.3.10/README.md))
- Mature. Validates JS/TS imports against `forbidden` / `allowed` /
  `required` rules with `from` / `to` path selectors. Detects cycles and
  orphans. Resolves `tsconfig` paths. Outputs JSON, graphs and HTML. Has a
  programmatic API.
- **Lesson: do not rebuild this.** Use it as the import-graph engine in the
  analyzer, and **generate a `.dependency-cruiser.cjs` from the model's
  invariants**. The diagram then becomes a CI gate.

**ArchUnitTS** ([GitHub](https://github.com/LukasNiessen/ArchUnitTS))
- Architecture tests in Jest/Vitest: layer dependency direction, cycles,
  metrics (LOC, cohesion). Can check structure against PlantUML diagrams.
- **Lesson:** an optional export target: generate `architecture.spec.ts` for
  teams that prefer tests over lint config.

**Nx module boundaries** ([docs](https://nx.dev/docs/features/enforce-module-boundaries.md))
- Tags on projects (`scope:*`, `type:*`) plus `depConstraints` in the ESLint
  rule.
- **Lesson:** for Nx monorepos, generate `depConstraints` from the model
  (element tags → Nx tags).

### 2.5 Specs for AI agents

**Kiro** and **GitHub Spec Kit** ([Martin Fowler article](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html), [comparison](https://glukhov.org/ai-devtools/ai-coding-assistants/spec-kit-vs-kiro-vs-claude-code/), [guide](https://medium.com/@visrow/comprehensive-guide-to-spec-driven-development-kiro-github-spec-kit-and-bmad-method-5d28ff61b9b1))
- Kiro: `.kiro/specs/<feature>/requirements.md`, `design.md`, `tasks.md`.
- Spec Kit: `spec.md`, `plan.md`, `tasks.md`, with a CLI, templates and prompts.
  It does not keep specs up to date after a change.
- Spec-driven development for agents is now mainstream.
- **Lesson:** the change-set export should **write Spec Kit / Kiro-compatible
  files**, so the architecture plan plugs into workflows people already use. The
  architecture model is also what keeps `design.md` up to date, which these
  tools do not do by themselves.

### 2.6 Architecture from runtime data

**Multiplayer** ([auto-documentation](https://scriptagc.wasmer.app/https_www_multiplayer_app/docs/features/system-auto-documentation), [press release](https://www.businesswire.com/news/home/20240625383448/en))
- Builds the architecture (components, dependencies, APIs) from OpenTelemetry
  traces and detects drift. Release status is unclear: the GA press release
  still calls the feature beta.
- **Lesson:** a later analyzer source: import OTel traces to confirm the
  real `calls` edges and their volume.

### 2.7 Visual model → code

**Amplication** ([GitHub](https://github.com/rfarrey/amplication), [deep dive](https://blog.brightcoding.dev/2025/09/05/automating-backend-code-and-apis-with-live-templates-and-plugins-a-deep-dive-into-amplication))
- Data models (visual or CLI) → NestJS + Prisma + REST/GraphQL + auth, pushed
  to GitHub. Same stack as our v1.
- **Lesson:** full code generation is a separate product. Keep our scaffolding
  minimal (folders, ports, stubs). Leave real code to the agent, which uses our
  plan.

### 2.8 PostgreSQL schema tools

**ChartDB** ([LogRocket](https://blog.logrocket.com/mastering-charts-database-visualization-chartdb/), [SourceForge](https://sourceforge.net/mirror/chartdb/profile))
- Open-source web ERD editor. Imports a schema with one "smart query". Supports
  Postgres. Self-hostable. AGPL according to one listing (check before you reuse code).
- **Lesson:** do not build a full ERD editor. Show a **light table view** in
  the database drill-down, and export DBML / SQL for ChartDB or dbdiagram.

**pg-introspection** ([npm](https://npmjs.com/package/pg-introspection))
- Typed parser of the full `pg_catalog`.
- Finding: `information_schema` foreign-key views can **return nothing for a
  read-only role** ([issue](https://github.com/AgamiAI/agami-core/issues/175)).
  Read from `pg_catalog` instead.
- **Lesson:** live DB introspection uses a read-only role + `pg_catalog`
  (via pg-introspection).

**arkit** ([GitHub](https://github.com/dyatko/arkit))
- JS/TS → component dependency diagrams (SVG/PNG/PlantUML). Note: rendering
  uses a hosted PlantUML web service by default.
- **Lesson:** a privacy point. Our analyzer runs fully locally, with no
  external rendering service.

---

## 3. Decisions taken from this research

| # | Decision | Source of the idea |
|---|---|---|
| R1 | MCP write tools take structured JSON, never DSL text; every response returns validation errors + rule findings | Structurizr MCP findings |
| R2 | Use **dependency-cruiser** as the import-graph engine (not tree-sitter) for the JS/TS-only v1 | dependency-cruiser |
| R3 | **Generate enforcement config** from the model: `.dependency-cruiser.cjs` (default), Nx `depConstraints`, ArchUnitTS spec (optional) | dependency-cruiser, Nx, ArchUnitTS |
| R4 | Change-set export also writes **Spec Kit** (`spec.md`/`plan.md`/`tasks.md`) and **Kiro** (`requirements.md`/`design.md`/`tasks.md`) layouts | Kiro, Spec Kit |
| R5 | Ship a **Claude Code skill** next to the MCP server | Eraser, Excalidraw MCP |
| R6 | Add **LikeC4** and **Structurizr DSL** exports; do not compete on DSLs | LikeC4, Structurizr |
| R7 | The Postgres drill-down is a light table view + DBML export, not a full ERD editor | ChartDB |
| R8 | Live DB introspection: optional, read-only role, `pg_catalog` via pg-introspection | pg-introspection, AgamiAI issue |
| R9 | Analyzer and rendering are 100% local | arkit (hosted renderer) |
| R10 | OpenTelemetry trace import as a later analyzer source | Multiplayer |
| R11 | Value is in the workflow (plan → agent → CI), not the picture | CodeSee |
| R12 | Scaffolding stays minimal; no business-logic generation | Amplication |
