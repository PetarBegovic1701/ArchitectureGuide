# ArchitectureGuide: Implementation

This is the **single source of truth** for building ArchitectureGuide. It
combines the plan, the v1 stack profile (React + Node.js + PostgreSQL), and the
research findings. It adds the implementation details: interfaces, algorithms,
file formats, tool schemas, commands, and a task checklist per phase.

The earlier planning notes (`docs/PLAN.md`, `docs/STACK-REACT-NODE-POSTGRES.md`,
`docs/RESEARCH.md`) were merged into this file and removed.

**Progress:** Phase 0 (foundations) is done. See §25 for the checklist.

---

## Contents

1. [Product summary](#1-product-summary)
2. [Scope of v1](#2-scope-of-v1)
3. [Research findings and decisions](#3-research-findings-and-decisions)
4. [System architecture](#4-system-architecture)
5. [Technology stack](#5-technology-stack)
6. [Repository layout](#6-repository-layout)
7. [Data model and file format](#7-data-model-and-file-format)
8. [Operations (the single way to change a model)](#8-operations-the-single-way-to-change-a-model)
9. [Concept catalog and visual language](#9-concept-catalog-and-visual-language)
10. [Relations and hard constraints](#10-relations-and-hard-constraints)
11. [Rules engine and anti-patterns](#11-rules-engine-and-anti-patterns)
12. [Templates](#12-templates)
13. [Web application](#13-web-application)
14. [Persistence, projects and sync](#14-persistence-projects-and-sync)
15. [Notes, annotations and decisions](#15-notes-annotations-and-decisions)
16. [Change sets (feature planning)](#16-change-sets-feature-planning)
17. [Exporters](#17-exporters)
18. [Repository analyzer](#18-repository-analyzer)
19. [MCP server](#19-mcp-server)
20. [Claude Code skill](#20-claude-code-skill)
21. [CLI](#21-cli)
22. [Enforcement and CI](#22-enforcement-and-ci)
23. [Security and privacy](#23-security-and-privacy)
24. [Testing strategy](#24-testing-strategy)
25. [Delivery phases and task checklists](#25-delivery-phases-and-task-checklists)
26. [Risks and mitigations](#26-risks-and-mitigations)
27. [Open decisions](#27-open-decisions)
28. [Glossary](#28-glossary)
29. [Sources](#29-sources)

---

## 1. Product summary

ArchitectureGuide is a drag-and-drop builder for frontend and backend
architecture.

- You place **geometric shapes** on a canvas. Each shape is an architectural
  concept (service, database, queue, port, page ...). The shape shows the
  category, the **label** names the element, the **color** shows the layer.
- You connect shapes with **typed relations** (`calls`, `reads`, `writes`,
  `enqueues` ...).
- The tool **blocks relations that make no sense** and **flags known
  anti-patterns**, with an explanation and a quick fix.
- You start from **built-in pattern templates** (Hexagonal, BFF, modular
  monolith, outbox ...).
- You keep **many projects**, with autosave, snapshots, **notes**,
  **annotations** and **decision records**.
- You **export** the architecture in a format that AI coding agents read well.
  You plan features as **change sets** and export them as task plans.
- An **MCP server** and a **CLI** analyze a repository, create a draft
  architecture model inside that repository, keep it in sync, and enforce it
  in CI.

### Goals

1. Simple to use: drag, type a name, connect. Smart defaults do the rest.
2. Semantic model, not only a picture.
3. Guard rails: hard constraints and anti-pattern rules.
4. Built-in patterns.
5. AI-agent-friendly export and feature planning.
6. Projects, saving, notes, annotations.
7. Repository analysis and enforcement through MCP, CLI and CI.

### Non-goals for v1

- Real-time multi-user collaboration (the data model is ready for it later).
- Class-level UML. The level is C4 "container" and "component".
- Generation of business logic. Only minimal scaffolding, later.

### Positioning

"An architecture linter with a canvas, for React + Node.js + PostgreSQL,
connected to your coding agent."

---

## 2. Scope of v1

v1 supports **one stack in depth**:

| Area | Supported in v1 |
|---|---|
| Frontend | React SPA built with Vite; React Router or TanStack Router; TanStack Query / SWR / RTK Query / Apollo; Zustand / Redux Toolkit / Context |
| Backend | Node.js (22 LTS and later) with Express, Fastify or NestJS; REST, GraphQL, tRPC, WebSocket (Socket.IO / ws) |
| Database | PostgreSQL through Prisma, Drizzle, TypeORM, Kysely, Knex or `pg`; pg-boss / graphile-worker job queues; LISTEN/NOTIFY |
| Languages | TypeScript and JavaScript |
| Repos | Single package or npm / pnpm / yarn workspaces; Turborepo and Nx detected |
| Infra signals | `docker-compose.yml`, `Dockerfile`, `.env*` files |

**Outside the profile, but placeable:** Redis, Kafka, S3, other databases,
other languages. You place them as the generic "Other data store" or "External
system". Only generic rules apply to them, and they show an "outside profile"
badge.

**Planned as v1.1 profiles:** Next.js / React Server Components,
Supabase / PostgREST. Later: Python, Go, Java profiles.

**Design rule:** the core (schema, canvas, rules engine, exporters, MCP, CLI)
is generic. All stack knowledge lives in a **stack profile** package
(`packages/profiles/react-node-postgres`). A new stack is a new profile. The
core does not change.

---

## 3. Research findings and decisions

### 3.1 Landscape

| Capability | Existing tools | What they lack for our goal |
|---|---|---|
| Architecture as code (C4, model + views) | Structurizr, LikeC4, Ilograph | Text first; no stack-aware anti-pattern rules |
| Drag-and-drop modelling | IcePanel, Cloudcraft, Excalidraw (+ MCP) | No semantic rules; no code enforcement |
| AI: repo → diagram | GitDiagram, Eraser, Archaic, repo-cartographer | Output is a picture (often Mermaid), not an editable checked model |
| Rules on real code | dependency-cruiser, ArchUnitTS, Nx module boundaries | No visual design; rules are written by hand |
| Specs for AI agents | Kiro, GitHub Spec Kit | Text specs; no visual architecture; specs go stale |
| Architecture from runtime | Multiplayer (OpenTelemetry), Cloudcraft (cloud accounts) | Needs a running system |
| Visual model → code | Amplication (NestJS + Prisma) | Code generation product, not architecture planning |
| Postgres schema diagrams | ChartDB | Database only |

**Gap:** no tool found combines a visual semantic canvas, stack-aware
anti-pattern rules, a two-way agent loop, and enforcement on the real code.

### 3.2 Key observations

- **Structurizr MCP:** its author reports that agents often need several
  correction rounds to write valid DSL. Agents improve when a parser returns
  clear errors.
- **LikeC4:** custom element kinds and notation work well, which supports our
  concept catalog approach. It has its own MCP server.
- **IcePanel:** sets the UX bar for "simple to use". Reusable model objects and
  "flows". The vendor says it covers C4 levels 1–3. Vendor pricing (Jan 2026): free for
  1–5 editors, then $40 and $80 per editor per month.
- **Eraser:** codebase diagrams from a prompt, a CI bot (Eraserbot) that keeps
  diagrams current, and support for Claude Code through MCP and Agent Skills.
- **GitDiagram:** popular open-source repo → Mermaid tool (MIT). Clicking a
  component opens its files. It is based on the file tree and README, not on code semantics.
- **Archaic:** desktop app + MCP; Claude Code reads the architecture and pushes
  updates. The closest to our two-way loop.
- **CodeSee:** sources conflict (shut down vs acquired by GitKraken in 2024).
  Careful lesson: visualization alone was hard to sustain.
- **dependency-cruiser:** mature JS/TS import rules (`forbidden` / `allowed` /
  `required`, `from` / `to` paths, cycles, orphans, tsconfig paths,
  programmatic API).
- **ArchUnitTS / Nx:** architecture tests in Jest/Vitest; tag-based
  `depConstraints` in Nx.
- **Kiro / Spec Kit:** `requirements.md` / `design.md` / `tasks.md` and
  `spec.md` / `plan.md` / `tasks.md`. Spec Kit specs stay static after a change.
- **Multiplayer:** architecture and drift from OpenTelemetry traces.
- **Amplication:** visual data model → NestJS + Prisma code; same stack as v1.
- **ChartDB:** open-source web ERD editor with Postgres import (AGPL according
  to one listing).
- **pg-introspection:** typed parser for `pg_catalog`. A known problem:
  `information_schema` foreign-key views can return nothing for a read-only
  role. `pg_catalog` does not have this problem.
- **arkit:** JS/TS diagrams, but uses a hosted PlantUML service by default.

### 3.3 Decisions (R1–R12)

| # | Decision | Where it is applied |
|---|---|---|
| R1 | MCP write tools take **structured JSON**, never DSL text. Every response returns validation errors and new rule findings. | §19 |
| R2 | The import graph comes from **dependency-cruiser** (v1 is JS/TS only). | §18 |
| R3 | **Generate enforcement config** from the model: `.dependency-cruiser.cjs` (default), Nx `depConstraints`, ArchUnitTS spec (optional). | §22 |
| R4 | Change sets export **Spec Kit** and **Kiro** file layouts. | §17 |
| R5 | Ship a **Claude Code skill** next to the MCP server. | §20 |
| R6 | Export to **LikeC4** and **Structurizr DSL**. Do not compete on DSLs. | §17 |
| R7 | Postgres drill-down is a light table view + **DBML** export, not a full ERD editor. | §13, §17 |
| R8 | Live DB introspection is optional, uses a **read-only role** and **`pg_catalog`**. | §18 |
| R9 | Analyzer, rendering and exports run **100% locally**. | §23 |
| R10 | OpenTelemetry trace import is a later analyzer source. | §25 (later) |
| R11 | The value is the workflow (plan → agent → CI), not the picture. | Whole product |
| R12 | Scaffolding stays minimal. No business-logic generation. | §25 (later) |

---

## 4. System architecture

```mermaid
flowchart LR
  subgraph Monorepo
    core["packages/core<br/>schema, ops, catalog, rules, graph, exporters"]
    profile["packages/profiles/react-node-postgres<br/>concepts, rules, templates, detectors, generators"]
    web["apps/web<br/>React canvas builder"]
    server["packages/server<br/>local server: static app + WebSocket + file IO"]
    cli["packages/cli<br/>archguide"]
    mcp["packages/mcp-server<br/>archguide-mcp"]
    analyzer["packages/analyzer<br/>detector runner"]
  end

  profile --> core
  web --> core
  web --> profile
  server --> core
  cli --> core
  cli --> analyzer
  cli --> server
  mcp --> core
  mcp --> analyzer
  analyzer --> core
  analyzer --> profile

  files[("architecture/*.archguide.json<br/>in the user's repo")]
  web <-- "WebSocket ops (serve mode)<br/>or File System Access API" --> server
  server <--> files
  cli <--> files
  mcp <--> files
  agent["AI agent<br/>(Claude Code ...)"] -- "MCP stdio" --> mcp
```

### 4.1 Principles

1. **All logic in `packages/core`.** Pure TypeScript, no DOM, no Node-only APIs
   (file IO lives in `server`, `cli`, `mcp-server`). The same schema, rules and
   exporters run in the browser, CLI, MCP and CI.
2. **Everything is an operation.** Every change (UI action, MCP call, template
   stamp, change set, undo, sync) is a list of `Op`s (§8).
3. **One model, many views.** Meaning is in the model, layout is in views.
4. **Files in git are the sync layer.** No hosted backend in v1.
5. **Profiles are plug-ins.** The core never imports a profile. Apps register
   profiles at startup.

### 4.2 Allowed dependencies between packages

We enforce this with our own generated dependency-cruiser config (dogfooding):

| Package | May import |
|---|---|
| `core` | nothing internal |
| `profiles/*` | `core` |
| `analyzer` | `core`, `profiles/*` |
| `server` | `core` |
| `cli` | `core`, `analyzer`, `server`, `profiles/*` |
| `mcp-server` | `core`, `analyzer`, `profiles/*` |
| `apps/web` | `core`, `profiles/*` (never `analyzer`, `server`, `cli`, `mcp-server`) |

---

## 5. Technology stack

Exact versions are pinned in the lockfile at Phase 0 (latest stable at that time).

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript 6 (strict, `moduleResolution: bundler`), ESM only | One language everywhere. TypeScript 7 (native compiler) once typescript-eslint supports it |
| Monorepo | pnpm workspaces + Turborepo | Fast, caching |
| Lint / format | ESLint (flat config) + Prettier | Standard |
| UI | React 19 + Vite | Fast dev loop |
| Canvas | `@xyflow/react` (React Flow 12) | Custom nodes/edges, handles, zoom, minimap, `isValidConnection` |
| State | Zustand 5 + Immer | Small, testable |
| Undo/redo | Own inverse-op history (§8) | Same ops as sync and MCP |
| Schema | Zod 4 → JSON Schema (`z.toJSONSchema`) | One source of truth |
| Script runner | `tsx` | Runs TypeScript scripts (schema generation) |
| Layout | `elkjs` in a Web Worker | Layered layout with groups |
| Rules in UI | Web Worker (Comlink) | Keeps canvas at 60 fps |
| Local DB | Dexie 4 (IndexedDB) | Local-first autosave |
| Files | File System Access API; download/upload fallback | Save into a repo |
| UI kit | Radix UI primitives + Tailwind CSS 4 + Lucide icons | Accessible |
| Markdown | `react-markdown` + `remark-gfm`; editor: CodeMirror 6 (markdown mode) | Notes |
| Image export | `html-to-image` | PNG/SVG of the viewport |
| Local server | Fastify + `@fastify/websocket` + `chokidar` | Serve mode |
| CLI | `commander` + `picocolors` | Simple |
| MCP | `@modelcontextprotocol/sdk` (stdio) | Claude Code and others |
| Import graph | `dependency-cruiser` (programmatic `cruise()`) | R2 |
| AST | `ts-morph` | Framework patterns, static config reading |
| Prisma schema | `@mrleebo/prisma-ast` | Parse `schema.prisma` without running Prisma |
| SQL | `libpg-query` (WASM, real Postgres parser) | Raw migrations |
| Live Postgres | `pg` + `pg-introspection` | R8 |
| YAML | `yaml` | compose files, YAML export |
| Ignore rules | `ignore` + `fast-glob` | Respect `.gitignore` |
| Tests | Vitest, `fast-check`, Playwright | Unit, property, e2e |

---

## 6. Repository layout

```
ArchitectureGuide/
├─ Implementation.md                # this file
├─ README.md
├─ package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json
├─ .dependency-cruiser.cjs          # generated from architecture/archguide.archguide.json
├─ architecture/                    # ArchitectureGuide's own model (dogfooding)
├─ schema/
│  └─ archguide.schema.json         # generated JSON Schema (published)
├─ apps/
│  └─ web/
│     ├─ src/app/                   # routes: workspace, project, settings
│     ├─ src/canvas/                # React Flow wrapper, ShapeNode, RelationEdge, handles
│     ├─ src/shapes/                # SVG shape registry
│     ├─ src/panels/                # Palette, Inspector, Problems, Notes, Decisions, ChangeSet, Layers
│     ├─ src/dialogs/               # Template picker, Export, Relation picker, Suppress
│     ├─ src/command/               # Command palette + shortcuts
│     ├─ src/store/                 # projectStore, uiStore, historyStore
│     ├─ src/workers/               # rules.worker.ts, layout.worker.ts
│     ├─ src/persistence/           # dexie.ts, fsAccess.ts, serveClient.ts
│     └─ e2e/                       # Playwright
├─ packages/
│  ├─ core/
│  │  ├─ src/schema/                # Zod schemas (§7)
│  │  ├─ src/ops/                   # Op types, apply, invert, validate (§8)
│  │  ├─ src/catalog/               # categories, generic concepts, relation types, registry
│  │  ├─ src/graph/                 # GraphQuery, SCC, paths, layers
│  │  ├─ src/rules/                 # engine + generic rules AP-*
│  │  ├─ src/templates/             # template engine
│  │  ├─ src/changesets/            # overlay, diff, task ordering
│  │  ├─ src/export/                # agent-md, yaml, plan, speckit, kiro, mermaid, likec4, structurizr, dbml
│  │  ├─ src/import/                # json, mermaid (subset), structurizr (subset)
│  │  ├─ src/serialize/             # deterministic JSON
│  │  ├─ src/migrate/               # schemaVersion migrations
│  │  └─ src/ids.ts
│  ├─ profiles/
│  │  └─ react-node-postgres/
│  │     ├─ src/concepts.ts  relations.ts  nesting.ts
│  │     ├─ src/rules/              # RNP-* rules
│  │     ├─ src/templates/          # T1–T13
│  │     ├─ src/detectors/          # analyzer detectors (§18)
│  │     ├─ src/generators/         # dependency-cruiser, nx, archunit (§22)
│  │     └─ src/index.ts            # export const profile: StackProfile
│  ├─ analyzer/
│  │  ├─ src/discover.ts  run.ts  resolve.ts  match.ts
│  │  ├─ src/engines/               # depcruise.ts, tsmorph.ts, prisma.ts, sql.ts, compose.ts, env.ts
│  │  ├─ src/introspect/            # live Postgres (pg_catalog)
│  │  └─ fixtures/                  # test repos
│  ├─ server/                       # archguide serve
│  ├─ cli/                          # archguide
│  └─ mcp-server/                   # archguide-mcp
├─ skills/
│  └─ archguide/SKILL.md            # Claude Code skill (§20), copied by `archguide init`
└─ docs/                            # generated reference docs (RULES.md from Phase 2)
```

---

## 7. Data model and file format

### 7.1 Model and views

There is **one model** (elements + relations) and **many views** (layouts).
A view holds positions and visibility only. Exports to agents use the model
only, so layout data never reaches the agent.

### 7.2 Schema (TypeScript shape; the real code is Zod)

```ts
// packages/core/src/schema/*.ts

type Id = string;            // slug, see 7.3
type Status = 'existing' | 'planned' | 'deprecated';
type Iso = string;           // ISO 8601 timestamp

interface Project {
  schemaVersion: 1;
  revision: number;          // +1 on every save; used for conflict detection (§14.5)
  id: Id;                    // "shop"
  name: string;
  description?: string;      // Markdown
  profile: string;           // "react-node-postgres"
  createdAt: Iso; updatedAt: Iso;
  derivedFrom?: { templateId: string; templateVersion: string; rootIds: Id[] }[];
  model: Model;
  views: View[];
  notes: Note[];
  decisions: Decision[];
  changeSets: ChangeSet[];
  snapshots: SnapshotRef[];  // metadata only; content in .archguide/snapshots/
  settings: ProjectSettings;
}

interface Model { elements: Element[]; relations: Relation[] }

interface Element {
  id: Id;                    // "svc.orders"
  kind: string;              // concept ID: "node.service", "pg.schema", "react.route"
  name: string;              // label
  description?: string;
  parentId?: Id;             // nesting
  layer?: 'presentation' | 'application' | 'domain' | 'infrastructure' | 'data' | 'external';
  tech?: string;             // "NestJS 11", "PostgreSQL 17"
  responsibilities?: string[];
  tags?: string[];
  color?: string;            // token name or hex; default from layer
  status: Status;
  owner?: string;            // team
  qualities?: {
    sensitivity?: 'public' | 'internal' | 'pii' | 'secret';
    criticality?: 'low' | 'medium' | 'high';
    scaling?: 'single' | 'horizontal' | 'serverless';
    sla?: string;
    slow?: boolean;          // external calls known to be slow (RNP-008)
  };
  properties?: Record<string, unknown>;  // validated by the concept's propertySchema
  codePaths?: string[];      // globs relative to repo root: "services/orders/src/domain/**"
  notes?: string;            // Markdown
  source?: Provenance;
}

interface Relation {
  id: Id;                    // "rel.web-calls-bff"
  type: string;              // relation type ID: "calls", "migrates", "enqueues" ...
  sourceId: Id;
  targetId: Id;
  label?: string;            // "POST /orders"
  mode?: 'sync' | 'async';   // default from relation type
  protocol?: 'http' | 'graphql' | 'trpc' | 'websocket' | 'grpc' | 'sql' | string;
  via?: string;              // ORM for reads/writes: "prisma", "drizzle" ...
  inTransaction?: boolean;   // for enqueues (RNP-007)
  contract?: string;         // path or URL: "openapi.yaml#/paths/~1orders/post"
  status: Status;
  notes?: string;
  source?: Provenance;
}

interface Provenance {
  origin: 'manual' | 'inferred' | 'template';
  confidence?: number;       // 0..1, for inferred
  evidence?: { path: string; line?: number; symbol?: string; detector?: string }[];
  reviewed?: boolean;        // a human accepted it
}

interface View {
  id: Id; name: string;
  kind: 'free' | 'context' | 'container' | 'component' | 'database' | 'scenario';
  scopeElementId?: Id;       // drill-down root
  nodes: { elementId: Id; x: number; y: number; w?: number; h?: number; collapsed?: boolean }[];
  edges: { relationId: Id; waypoints?: { x: number; y: number }[]; labelPos?: number }[];
  annotations: Annotation[];
  scenario?: { steps: { relationId: Id; note?: string }[] };   // for kind = scenario
}

interface Annotation {
  id: Id;
  kind: 'sticky' | 'callout' | 'comment' | 'region';
  text: string;              // Markdown
  anchor: { elementId: Id } | { relationId: Id } | { x: number; y: number; w?: number; h?: number };
  color?: string;
  replies?: { author?: string; text: string; createdAt: Iso }[];
  resolved?: boolean;
  author?: string; createdAt: Iso;
}

interface Note { id: Id; title: string; body: string; linkedIds: Id[]; updatedAt: Iso }

interface Decision {         // lightweight ADR
  id: Id;                    // "adr-004"
  title: string;
  status: 'proposed' | 'accepted' | 'superseded' | 'rejected';
  context: string; decision: string; consequences: string;
  supersededBy?: Id;
  linkedIds: Id[];
  date: Iso;
}

interface ChangeSet {
  id: Id;                    // "cs.add-payments"
  name: string;
  description: string;       // Markdown: the feature request
  status: 'draft' | 'ready' | 'implemented' | 'abandoned';
  baseRevision: number;      // project revision the change set was based on
  ops: Op[];                 // §8
  tasks?: Task[];            // generated, then editable (§16.4)
}

interface Task { id: Id; title: string; detail?: string; elementIds: Id[]; dependsOn: Id[]; done: boolean }

interface ProjectSettings {
  rulePacks: string[];       // enabled packs
  ruleOverrides: Record<string, 'off' | 'info' | 'warning' | 'error'>;
  suppressions: Suppression[];
  thresholds: { fanOut: number; fanIn: number; syncDepth: number; frontendDirectServices: number };
  palette?: Record<string, string>;
  codeRoot?: string;         // relative path from the architecture folder to the repo root, default ".."
}

interface Suppression { ruleId: string; targetIds: Id[]; reason: string; decisionId?: Id; createdAt: Iso }

interface SnapshotRef { id: Id; name: string; revision: number; createdAt: Iso }
```

### 7.3 IDs

- Format: `<prefix>.<slug>`, lowercase, `[a-z0-9-]`, separated by `.`.
  Example: `svc.orders`, `db.orders`, `schema.orders`, `route.checkout`.
- The concept defines the prefix (`idPrefix`). The slug comes from the name.
- Collisions get a suffix: `svc.orders-2`.
- IDs never change on rename unless the user asks. An MCP `rename_id` tool and a
  UI action update all references.
- Relation IDs: `rel.<source-slug>-<type>-<target-slug>`.
- Why slugs: readable exports, readable git diffs, and agents can refer to
  elements by name.

### 7.4 Deterministic serialization

`core/serialize` writes JSON with:
- 2-space indentation, `\n` line endings, final newline;
- object keys in schema order (not alphabetical, so files stay readable);
- `elements`, `relations`, `notes`, `decisions` sorted by `id`; view `nodes` by
  `elementId`;
- empty optional fields left out.

Property test: `serialize(parse(serialize(p))) === serialize(p)`.

### 7.5 Files on disk

```
<repo>/
└─ architecture/
   ├─ archguide.config.json         # workspace config
   ├─ shop.archguide.json           # one file per project
   ├─ ARCHITECTURE.md               # generated (agent Markdown), optional
   ├─ plans/                        # generated change-set plans
   │  └─ cs.add-payments.md
   └─ .archguide/
      ├─ snapshots/shop/<snapshot-id>.json
      ├─ analysis/last.json         # last analyzer result (gitignored)
      └─ dependency-cruiser.cjs     # generated (can also be written to repo root)
```

`archguide.config.json`:

```json
{
  "$schema": "https://archguide.dev/schema/config.json",
  "profile": "react-node-postgres",
  "defaultProject": "shop",
  "codeRoot": "..",
  "exports": [
    { "format": "agent-md", "project": "shop", "out": "ARCHITECTURE.md" },
    { "format": "dependency-cruiser", "project": "shop", "out": "../.dependency-cruiser.cjs" }
  ],
  "analyzer": {
    "include": ["apps/**", "services/**", "packages/**"],
    "exclude": ["**/*.test.*", "**/fixtures/**"],
    "maxFiles": 20000,
    "database": { "urlEnv": "ARCHGUIDE_DATABASE_URL_READONLY" }
  }
}
```

The database URL is **never** stored. Only the name of the environment
variable is stored.

### 7.6 Migrations

`schemaVersion` starts at 1. `core/migrate` has one function per version step
(`v1→v2` ...). Every released version has a fixture file. A test migrates each
fixture to the latest version and validates it.

---

## 8. Operations (the single way to change a model)

### 8.1 Op types

Implemented in `packages/core/src/schema/ops.ts`.

```ts
// Model ops: everything a change set may hold.
type ModelOp =
  | { op: 'addElement'; element: Element }
  | { op: 'updateElement'; id: Id; patch: Patch }        // shallow merge; null removes a field; no id / parentId
  | { op: 'removeElement'; id: Id; cascade?: boolean }   // cascade: also children and relations
  | { op: 'moveElement'; id: Id; parentId: Id | null }
  | { op: 'addRelation'; relation: Relation }
  | { op: 'updateRelation'; id: Id; patch: Patch }
  | { op: 'removeRelation'; id: Id }
  | { op: 'renameId'; from: Id; to: Id }                 // element or relation
  | { op: 'addView'; view: View }
  | { op: 'updateView'; id: Id; patch: Patch }           // name, kind, scopeElementId, scenario
  | { op: 'removeView'; id: Id }
  | { op: 'setViewNode'; viewId: Id; node: ViewNode } | { op: 'removeViewNode'; viewId: Id; elementId: Id }
  | { op: 'setViewEdge'; viewId: Id; edge: ViewEdge } | { op: 'removeViewEdge'; viewId: Id; relationId: Id }
  | { op: 'upsertAnnotation'; viewId: Id; annotation: Annotation } | { op: 'removeAnnotation'; viewId: Id; id: Id }
  | { op: 'upsertNote'; note: Note } | { op: 'removeNote'; id: Id }
  | { op: 'upsertDecision'; decision: Decision } | { op: 'removeDecision'; id: Id }
  | { op: 'upsertSuppression'; suppression: Suppression } | { op: 'removeSuppression'; ruleId: string; targetIds: Id[] }
  | { op: 'updateProject'; patch: Patch }                // name, description, profile, derivedFrom
  | { op: 'updateSettings'; patch: Patch };              // any ProjectSettings field

// All ops. Change sets hold ModelOps only, so ops never nest more than one level.
type Op = ModelOp
  | { op: 'upsertChangeSet'; changeSet: ChangeSet }
  | { op: 'removeChangeSet'; id: Id };
```

Rules that apply to all ops:
- Elements and relations share **one ID space**.
- Every op is validated with `OpSchema` first (ops from MCP and sync are untrusted).
- Patches are merged, then the full item is validated, so a patch cannot break an item.
- Removing an element or relation also removes its view nodes/edges, the
  annotations anchored to it, view scopes and scenario steps that point at it.
  The inverse restores all of them.
- `renameId` updates parents, relation ends, views, anchors, note/decision links,
  suppressions, and element properties whose value is exactly the old ID
  (for example `pg.schema` `ownedBy`). It does not rewrite ops stored in change sets.

### 8.2 Functions (`core/ops`)

```ts
applyOps(project, ops, catalog):                   // pure; works on a structuredClone copy
  | { ok: true; project: Project; inverse: Op[] }
  | { ok: false; errors: OpError[] }
validateOps(project, ops, catalog): OpError[]      // same checks, no result
```

- `applyOps` is all-or-nothing. If one op fails validation, nothing changes.
- `inverse` is the list of ops that undoes the change (used by undo, §13.6).
- `OpError = { index: number; code: ErrorCode; itemId?: Id; message: string; hint?: string; fix?: Op[] }`.

Error codes: `SCHEMA_INVALID`, `ID_EXISTS`, `ID_NOT_FOUND`, `UNKNOWN_KIND`,
`UNKNOWN_RELATION`, `RELATION_NOT_ALLOWED`, `NESTING_NOT_ALLOWED`,
`NESTING_CYCLE`, `SELF_RELATION`, `PROPERTY_INVALID`, `HAS_DEPENDENTS`
(remove without `cascade`), `REVISION_CONFLICT`.

For `RELATION_NOT_ALLOWED`, `fix` holds the flipped relation when the reverse
direction is valid (for example "Database calls Service" → "Service reads Database").

### 8.3 Who uses ops

| User of ops | How |
|---|---|
| Web UI | Every action dispatches ops to `projectStore` |
| Undo / redo | Stores `inverse` ops |
| Serve-mode sync | UI sends ops over WebSocket; server applies + broadcasts |
| MCP tools | Each write tool builds ops, validates, applies |
| Templates | `build(params)` returns ops |
| Change sets | Store ops; overlay = apply to a copy |
| Quick fixes | Return ops; preview before apply |
| Analyzer | Candidate model → ops against the current model |

---

## 9. Concept catalog and visual language

### 9.1 Catalog types

```ts
interface Category {
  id: CategoryId;            // 'deployable' | 'module' | 'ui' | 'domain-core' | 'domain-object' | 'port' | 'adapter'
                             // | 'data-at-rest' | 'data-in-motion' | 'event' | 'routing' | 'security'
                             // | 'actor' | 'external' | 'group' | 'cross-cutting' | 'client-state'
  shape: ShapeId;
  defaultLayer?: Element['layer'];
}

interface Concept {
  id: string;                // "node.service"
  name: string;              // "Node service"
  category: CategoryId;
  shape?: ShapeId;           // overrides the category shape
  icon: string;              // Lucide icon name or profile SVG
  idPrefix: string;          // "svc"
  defaultLayer?: Element['layer'];
  allowedParents: Selector[]; // "top" = may have no parent; see Selector in §10.3
  nestingHint?: string;      // shown when a nesting is refused
  propertySchema?: ZodType;  // validates Element.properties; unknown keys allowed
  palette: { group: 'Frontend' | 'Backend' | 'Data' | 'Infra' | 'Events' | 'Groups' | 'Generic'; order: number; basic: boolean };
  docs: string;              // Markdown: what it is, when to use
  aliases?: string[];        // palette search: "prisma" finds Repository
}

interface StackProfile {
  id: string; name: string; version: string;
  concepts: Concept[];
  relationTypes: RelationType[];
  relationRules: RelationRule[];       // §10.3; checked before core rules
  // Added in later phases:
  rules: Rule[];                       // §11
  rulePacks: RulePack[];
  templates: Template[];               // §12
  detectors: Detector[];               // §18
  generators: EnforcementGenerator[];  // §22
}
```

`basic: true` concepts show in the "Basic" palette mode. "Full" mode shows all.

### 9.2 Shapes

| Shape ID | Drawing | Default size (px) | Category |
|---|---|---|---|
| `rect` | Rectangle, 4px radius | 160×80 | deployable |
| `rounded` | Rectangle, 16px radius | 140×64 | module |
| `window` | Rectangle with a 16px title bar | 160×100 | ui |
| `hexagon` | Flat-top hexagon | 120×104 | domain-core |
| `hexagon-sm` | Small hexagon | 84×72 | domain-object |
| `circle` | Circle | 56×56 | port |
| `plug` | Rounded square with a plug notch | 120×64 | adapter |
| `cylinder` | Vertical cylinder | 110×90 | data-at-rest |
| `cylinder-dashed` | Vertical cylinder, dashed outline | 90×72 | client-state / views |
| `pipe` | Horizontal cylinder | 150×56 | data-in-motion |
| `triangle` | Triangle | 80×70 | event |
| `diamond` | Diamond | 100×100 | routing |
| `octagon` | Octagon | 90×90 | security |
| `actor` | Head + body | 60×80 | actor |
| `cloud` | Cloud | 150×90 | external |
| `gear` | Rounded rect with a gear badge | 120×64 | cross-cutting |
| `container` | Dashed rectangle with a title tab, resizable | min 240×160 | group |

Each shape is one React component that draws an SVG `path` from width and
height (`shapes/registry.ts`). Every shape has four handles (top, right,
bottom, left) and uses React Flow "loose" connection mode. The icon sits in the
top-left corner, the label in the center (wraps to 2 lines, then ellipsis),
and the status / finding badges sit in the top-right corner.

### 9.3 Color

Color tokens per layer (light / dark variants; WCAG AA for label text):

| Layer | Token | Light | Dark |
|---|---|---|---|
| presentation | `--ag-presentation` | `#3B82F6` | `#60A5FA` |
| application | `--ag-application` | `#14B8A6` | `#2DD4BF` |
| domain | `--ag-domain` | `#8B5CF6` | `#A78BFA` |
| infrastructure | `--ag-infrastructure` | `#64748B` | `#94A3B8` |
| data | `--ag-data` | `#F59E0B` | `#FBBF24` |
| external | `--ag-external` | `#78716C` | `#A8A29E` |

The fill is the token at 12% opacity. The stroke is the full token color.

**Color-by modes:** layer (default), owner/team (generated palette), status
(existing = solid, planned = dashed outline, deprecated = gray + strike),
change set (added green, changed amber, removed red), finding severity.
A legend is generated for the active mode.

### 9.4 Generic concepts (core)

| ID | Name | Category |
|---|---|---|
| `gen.actor` | User / actor | actor |
| `gen.external` | External system | external |
| `gen.auth-provider` | Auth provider | security |
| `gen.gateway` | API gateway / reverse proxy | routing |
| `gen.cdn` | CDN / static hosting | routing |
| `gen.other-store` | Other data store (outside profile) | data-at-rest |
| `gen.other-broker` | Other message broker (outside profile) | data-in-motion |
| `gen.cross-cutting` | Logging / config / feature flags / observability | cross-cutting |
| `group.layer` | Layer | group |
| `group.context` | Bounded context | group |
| `group.zone` | Deployment zone / network | group |
| `group.team` | Team boundary | group |

### 9.5 React concepts

| ID | Name | Shape | Prefix | Allowed parents | Key properties |
|---|---|---|---|---|---|
| `react.app` | React app | rect | `app` | top, `group.*` | `bundler: 'vite'`, `router: 'react-router' \| 'tanstack-router'`, `rendering: 'csr'` |
| `react.route` | Route / page | window | `route` | `react.app`, `react.layout` | `path`, `lazy`, `authRequired` |
| `react.layout` | Layout route | window | `layout` | `react.app`, `react.layout` | `path` |
| `react.feature` | Feature module | rounded | `feat` | `react.app`, `group.layer` | `folder`, `fsdLayer: 'app' \| 'pages' \| 'widgets' \| 'features' \| 'entities' \| 'shared'` |
| `react.component` | Shared component | rounded | `cmp` | `react.app`, `react.feature`, `react.design-system` | `folder` |
| `react.design-system` | UI kit / design system | rounded | `ds` | top, `react.app` | `package` |
| `react.hook` | Custom hook | rounded | `hook` | `react.app`, `react.feature` | – |
| `react.server-state` | Server-state cache | cylinder-dashed | `qcache` | `react.app` | `lib: 'tanstack-query' \| 'swr' \| 'rtk-query' \| 'apollo'` |
| `react.client-store` | Client state store | cylinder-dashed | `store` | `react.app`, `react.feature` | `lib: 'zustand' \| 'redux-toolkit' \| 'context' \| 'jotai'` |
| `react.api-client` | API client | plug | `apic` | `react.app` | `kind: 'fetch' \| 'axios' \| 'openapi-generated' \| 'trpc' \| 'graphql'` |

### 9.6 Node.js concepts

| ID | Name | Shape | Prefix | Allowed parents | Key properties |
|---|---|---|---|---|---|
| `node.service` | Node service | rect | `svc` | top, `group.*` | `framework: 'express' \| 'fastify' \| 'nestjs'`, `runtime`, `transport[]` |
| `node.bff` | Backend-for-Frontend | rect | `bff` | top, `group.*` | same as service, `client` (element ID) |
| `node.worker` | Background worker | rect (cog) | `wrk` | top, `group.*` | `jobLib: 'pg-boss' \| 'graphile-worker'`, `concurrency` |
| `node.scheduler` | Scheduled job | rect (clock) | `cron` | top, `node.service`, `node.worker` | `lib`, `cron` |
| `node.ws-gateway` | Realtime gateway | diamond | `ws` | top, `node.service` | `lib: 'socket.io' \| 'ws'` |
| `node.module` | Module | rounded | `mod` | `node.service`, `node.bff`, `node.worker`, `group.*` | `exports[]` (public API) |
| `node.route-handler` | Controller / route handler | rounded | `ctl` | `node.service`, `node.bff`, `node.module` | `routes[]`, `validation` |
| `node.middleware` | Middleware | rounded (filter) | `mw` | `node.service`, `node.bff`, `node.module` | `kind: 'auth' \| 'validation' \| 'rate-limit' \| 'error'` |
| `node.use-case` | Use case / application service | rounded | `uc` | `node.service`, `node.module` | – |
| `node.domain` | Domain model / aggregate | hexagon | `dom` | `node.service`, `node.module`, `group.context` | `invariants[]` |
| `node.port` | Port (interface) | circle | `port` | `node.service`, `node.module` | – |
| `node.repository` | Repository / data access | plug | `repo` | `node.service`, `node.module` | `dataAccess: 'prisma' \| 'drizzle' \| 'typeorm' \| 'kysely' \| 'knex' \| 'pg'` |
| `node.event` | Domain / integration event | triangle | `evt` | any non-data element | `payloadSchema` |
| `node.contract` | API contract package | circle (document) | `api` | top, `group.*` | `kind: 'openapi' \| 'zod' \| 'trpc-router' \| 'graphql-schema'` |
| `node.shared-lib` | Shared package | rounded (stacked) | `lib` | top, `group.*` | `package` |

The ORM is a **property** (`dataAccess`, or `via` on relations), not a shape.

### 9.7 PostgreSQL concepts

| ID | Name | Shape | Prefix | Allowed parents | Key properties |
|---|---|---|---|---|---|
| `pg.cluster` | Postgres server | container (elephant) | `pgc` | top, `group.zone` | `version`, `hosting: 'self' \| 'rds' \| 'neon' \| 'supabase' \| ...` |
| `pg.database` | Database | cylinder | `db` | top, `pg.cluster`, `group.*` | `extensions[]` |
| `pg.schema` | Schema | cylinder (segment), acts as group | `schema` | `pg.database` | `ownedBy` (element ID), `migrationTool`, `rls` |
| `pg.table` | Table | small rect (database view only) | `tbl` | `pg.schema` | `columns[]`, `primaryKey[]`, `foreignKeys[]`, `indexes[]` |
| `pg.view` | View / materialized view | cylinder-dashed | `view` | `pg.schema` | `materialized`, `refresh` |
| `pg.replica` | Read replica | cylinder (copy) | `replica` | top, `pg.cluster` | `lagTolerance` |
| `pg.pooler` | Connection pooler | diamond (small) | `pool` | top, `pg.cluster` | `kind: 'pgbouncer' \| 'pgcat' \| 'rds-proxy' \| 'app-pool'`, `mode` |
| `pg.job-queue` | Postgres job queue | pipe | `jobs` | top, `pg.database`, `pg.schema` | `lib: 'pg-boss' \| 'graphile-worker'`, `queues[]` |
| `pg.channel` | LISTEN/NOTIFY channel | pipe (thin) | `chan` | top, `pg.database` | `channel` |

---

## 10. Relations and hard constraints

### 10.1 Direction rule

Edges point **from the element that initiates or depends, to the element it
depends on.** Producers and consumers both point at the queue. This makes
cycle detection and the dependency rule simple.

### 10.2 Relation types

```ts
interface RelationType {
  id: string;
  name: string;
  mode: 'sync' | 'async' | 'static';    // static = compile-time / structural
  specializes?: string;                 // "enqueues" specializes "publishes"
  line: { dash?: string; width: 1 | 1.5 | 2.5; marker: 'arrow' | 'open-arrow' | 'triangle-hollow' | 'diamond-tail' | 'none' };
  defaultPriority: number;              // lower = offered first in the picker
  hint?: string;                        // shown when no allow rule matches a pair
  docs: string;
}
```

| Relation | Mode | Line | Meaning | Profile |
|---|---|---|---|---|
| `calls` | sync | solid, arrow | Request/response; `protocol` property | core |
| `publishes` | async | dashed, open arrow | Sends a message/event | core |
| `consumes` | async | dashed, open arrow | Receives messages | core |
| `reads` | sync | solid thin | Reads data; `via` property | core |
| `writes` | sync | solid thick | Writes data; `via` property | core |
| `depends-on` | static | dotted | Compile-time import | core |
| `implements` | static | dotted, hollow triangle | Adapter realizes a port | core |
| `uses-port` | static | dotted, open arrow | Depends on an interface | core |
| `renders` | static | solid, diamond tail | UI composition | core |
| `navigates` | sync | solid curved | UI navigation | core |
| `emits` | async | dashed, triangle | Raises a domain event | core |
| `handles` | async | dashed | Reacts to an event | core |
| `authenticates-with` | sync | dash-dot | Auth dependency | core |
| `migrates` | static | dotted thick | Owns the DDL / migrations | RNP |
| `enqueues` | async | dashed | Adds a job; `inTransaction` | RNP (specializes `publishes`) |
| `processes` | async | dashed | Runs jobs | RNP (specializes `consumes`) |
| `notifies` | async | dashed thin | `NOTIFY` | RNP |
| `listens` | async | dashed thin | `LISTEN` | RNP |
| `connects-via` | sync | solid thin | DB connections through a pooler | RNP |
| `replicates-to` | async | dotted | Replication | RNP |
| `serves` | static | solid, open arrow | Node serves the SPA build | RNP |
| `uses-state` | static | dotted | Component/route → store | RNP |
| `fetches-via` | sync | solid thin | Server-state/hook → API client | RNP |

Nesting (component inside service) uses `parentId`, never an edge.

### 10.3 Compatibility matrix

```ts
// Selector: "*" | "node.service" | "pg.*" | "category:<id>" | "group:<palette group>"
//           ("top" only in allowedParents)
type RelationRule = AllowRule | DenyRule;

interface AllowRule {
  type: string | string[];
  from: Selector[];
  to: Selector[];
  allowSelf?: boolean;       // default false
  priority?: number;         // overrides the type's defaultPriority for matching pairs
}

interface DenyRule {         // wins over every allow rule; the first match gives the message
  type: string | string[];   // "*" = every type
  deny: { from?: Selector[]; to?: Selector[] };   // a missing side matches anything
  message: string;
}
```

Implemented in `packages/core/src/catalog`: `createCatalog(profiles)`,
`validRelationTypes`, `checkRelation` (with `alternatives` and `flip`),
`checkNesting`. Groups (`category:group`) never take part in relations.

Core rules (excerpt):

```ts
[
  { type: 'calls',     from: ['category:actor','category:ui','category:deployable','category:module','category:routing','category:adapter'],
                       to:   ['category:deployable','category:module','category:routing','category:external','category:port'] },
  { type: 'reads',     from: ['category:deployable','category:module','category:adapter'], to: ['category:data-at-rest'] },
  { type: 'writes',    from: ['category:deployable','category:module','category:adapter'], to: ['category:data-at-rest'] },
  { type: 'publishes', from: ['category:deployable','category:module','category:adapter','category:data-at-rest'], to: ['category:data-in-motion'] },
  { type: 'consumes',  from: ['category:deployable','category:module','category:adapter'], to: ['category:data-in-motion'] },
  { type: 'depends-on',from: ['category:module','category:deployable','category:adapter','category:domain-core'], to: ['category:module','category:port','category:domain-core','category:domain-object'] },
  { type: 'implements',from: ['category:adapter'], to: ['category:port'] },
  { type: 'uses-port', from: ['category:module','category:domain-core'], to: ['category:port'] },
  { type: 'renders',   from: ['category:ui','category:module'], to: ['category:ui','category:module'] },
  { type: 'navigates', from: ['category:ui'], to: ['category:ui'] },
  { type: 'emits',     from: ['category:domain-core','category:domain-object','category:module'], to: ['category:event'] },
  { type: 'handles',   from: ['category:module','category:deployable'], to: ['category:event'] },
  { type: 'authenticates-with', from: ['category:ui','category:deployable','category:routing'], to: ['category:security','category:external'] },
]
```

The profile adds rules for its relations and **restricts** core ones with
`deny` entries (deny wins over allow):

```ts
{ type: 'reads',  deny: { from: ['group:Frontend'], to: ['pg.*'] }, message: 'Browser code cannot connect to PostgreSQL. Go through a Node service.' }
{ type: 'writes', deny: { to: ['pg.replica'] }, message: 'Replicas are read-only. Write to the primary database.' }
```

### 10.4 Hard constraints (blocked)

| Attempt | Error code | Message | Offered fix |
|---|---|---|---|
| Data store `calls` anything | `RELATION_NOT_ALLOWED` | "A data store does not call anything. Did you mean the service *reads/writes* it?" | Flip + change to `reads` |
| Queue `calls` worker | same | "Queues do not call consumers. Use Worker *consumes/processes* Queue." | Flip + `processes` |
| Port `implements` adapter | same | "Reversed. Adapters implement ports." | Flip |
| Domain object `reads` DB | same | "Domain objects have no I/O. Use a repository." | Insert repository |
| Event → any outgoing relation | same | "Events are facts. They do not depend on anything." | – |
| Any `react.*` `reads`/`writes` `pg.*` | same | "Browser code cannot connect to PostgreSQL." | Insert Node service |
| `pg.*` `calls` anything | same | "PostgreSQL does not call services." | Flip + `reads` |
| `writes` → `pg.replica` | same | "Replicas are read-only." | Retarget to primary |
| `processes` from non-Node element | same | "Only Node processes run jobs." | – |
| `migrates` from a `react.*` element | same | "Migrations run from backend code." | – |
| Self relation (where not allowed) | `SELF_RELATION` | "An element cannot relate to itself here." | – |
| `pg.table` outside `pg.schema` | `NESTING_NOT_ALLOWED` | "Tables live in a schema (default: `public`)." | Create `public` schema |
| `react.*` nested in `node.service` | `NESTING_NOT_ALLOWED` | "Use the *serves* relation instead of nesting." | Add `serves` |
| Nesting cycle | `NESTING_CYCLE` | "An element cannot be inside itself." | – |

### 10.5 Smart defaults

```ts
// core/catalog/relations.ts
validRelationTypes(sourceKind, targetKind, catalog): RelationType[]   // allow rules minus deny rules, sorted by defaultPriority
```

On connect in the UI:
- 0 valid types → refuse, show the message of the first matching deny rule (or
  a generic one), plus the offered fix if any (§10.4);
- 1 valid type → create it directly;
- 2+ → show the relation picker popup at the drop point with only the valid
  types. `Enter` takes the first. The last choice for the same kind pair is
  remembered and becomes the first option.

`mode` and `protocol` get defaults: `calls` between React and Node → `http`;
`reads`/`writes` → `via` from the source's `dataAccess` property.

---

## 11. Rules engine and anti-patterns

### 11.1 API

```ts
interface Rule {
  id: string;                         // "AP-003", "RNP-001"
  title: string;
  severity: 'error' | 'warning' | 'info';
  pack: string;
  replaces?: string[];                // when this rule's pack is on, the listed rules are off
  scope: 'model' | 'analysis';        // analysis = needs analyzer facts (CLI/MCP/CI, or UI after a scan)
  rationale: string;                  // Markdown, shown in UI and docs
  references?: string[];
  check(ctx: RuleContext): Finding[];
  quickFixes?: (f: Finding, ctx: RuleContext) => QuickFix[];
}

interface RuleContext {
  graph: GraphQuery;
  project: Project;
  catalog: Catalog;
  settings: ProjectSettings;
  analysis?: AnalysisResult;          // §18
}

interface Finding {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  targetIds: Id[];                    // elements/relations to badge
  evidence?: Provenance['evidence'];
  suppressed?: { reason: string; decisionId?: Id };
}

interface QuickFix { title: string; ops: Op[] }

runRules(ctx, { changeSetId?, only?: string[] }): Finding[]
```

### 11.2 GraphQuery

```ts
interface GraphQuery {
  element(id): Element | undefined;
  relation(id): Relation | undefined;
  elementsOfKind(pattern: string): Element[];          // "pg.*", "node.service"
  elementsOfCategory(cat): Element[];
  outgoing(id, types?: string[]): Relation[];
  incoming(id, types?: string[]): Relation[];
  children(id): Element[]; ancestors(id): Element[]; deployableOf(id): Element | undefined;
  layerOf(id): Element['layer'];
  paths(fromId, toId, opts: { types?: string[]; maxDepth: number }): Id[][];
  reachable(fromId, opts): Set<Id>;
  scc(types: string[]): Id[][];                         // Tarjan, components with size > 1
  syncDepthFrom(id): number;                            // longest sync `calls` chain (DFS with cycle guard)
  fanIn(id, types?): number; fanOut(id, types?): number;
}
```

- **Relation lifting:** a relation from a child counts for its ancestors when a
  rule asks at deployable level (`deployableOf`). Example: `ctl.orders` (inside
  `svc.orders`) writes `schema.orders` → `svc.orders` writes `schema.orders`.
- The graph index (adjacency maps by type) is rebuilt incrementally from ops.

### 11.3 Execution

- **UI:** rules run in `rules.worker.ts`, debounced 150 ms after the last op.
  Results are keyed by target ID for badges.
- **Performance budget:** 500 elements / 1,000 relations → full run < 100 ms.
  Rules declare the relation types they read. After an op, only the rules
  that read the touched types run again.
- **CLI / MCP / CI:** same `runRules`, plus `scope: 'analysis'` rules when
  analysis facts exist.

### 11.4 Rule packs

| Pack | Content | On by default |
|---|---|---|
| `core` | AP-003, AP-008, AP-011, AP-014, AP-016, AP-018 | always |
| `layered` | AP-005, RNP-005 | T2 |
| `hexagonal` | AP-004, RNP-006, RNP-005 | T3 |
| `modular-monolith` | module public API rules, one migration owner per schema; turns AP-001 off | T4 |
| `microservices` | AP-001/RNP-001, AP-006, AP-007, RNP-011 | T5, T6 |
| `event-driven` | AP-011, AP-012, AP-017, RNP-007, RNP-010 | T7, T8, T10 |
| `cqrs` | read side must not write the write model | T9 |
| `frontend` | AP-002, RNP-003, RNP-004, RNP-012 | all React templates |
| `fsd` | RNP-013, RNP-014 | T11 |
| `security` | AP-010/RNP-016, AP-015 | T13; recommended for all |
| `react-node-postgres` | all RNP rules not listed above | when the profile is active |

### 11.5 Generic anti-patterns (AP)

| ID | Anti-pattern | Detection | Sev. | Quick fix | Replaced by (RNP pack) |
|---|---|---|---|---|---|
| AP-001 | Shared database between services | ≥2 deployables `write` the same data store (lifted) | warn | Split stores; one owner + API | RNP-001 |
| AP-002 | Frontend talks to database | Path from a `ui`/Frontend element to `data-at-rest` with no deployable backend in between | error | Insert API/BFF | – |
| AP-003 | Cyclic dependency | `scc(['depends-on','calls'])` among modules or deployables | warn | Show the cycle; suggest an event or a port | – |
| AP-004 | Dependency rule violation | Element in `domain` layer has `depends-on`/`calls`/`reads`/`writes` to `infrastructure`/`presentation`/data | warn | Insert a port; adapter implements it | – |
| AP-005 | Layer skipping | Presentation → data, or handler → repository with no use case (layered/hexagonal packs only) | warn | Insert use case | – |
| AP-006 | Distributed monolith | Sync `calls` cycle between deployables, or a request chain with sync calls to > N deployables | warn | Make calls async; merge services | – |
| AP-007 | Chatty sync chain | `syncDepthFrom(entry) > thresholds.syncDepth` (default 4) | warn | Async, aggregation, caching | – |
| AP-008 | God element | `fanIn + fanOut > thresholds` or > 7 responsibilities | warn | Split by subdomain | – |
| AP-009 | Frontend fan-out | UI calls > `frontendDirectServices` deployables directly | warn | Add BFF/gateway | RNP-011 |
| AP-010 | Public entry without auth | Path actor → deployable with no `authenticates-with` / auth middleware / gateway | warn | Add auth | RNP-016 |
| AP-011 | Orphan messaging | Queue/topic with producers but no consumers, or the reverse | warn | Add the missing side | – |
| AP-012 | Missing dead-letter handling | Consumer of a queue with no DLQ property (info) | info | Add DLQ | – |
| AP-013 | Dual write | Writes a store and publishes/calls external in the same deployable, no outbox | warn | Apply Outbox template | RNP-007 |
| AP-014 | Cache as source of truth | Cache with writes but no backing store | warn | Add a backing store | – |
| AP-015 | Sensitive data leak | `pii`/`secret` store reachable from `public` zone or external system without a boundary | error | Add a boundary / anonymizing service | – |
| AP-016 | Disconnected element | No relations and no parent (except groups, notes) | info | Connect or delete | – |
| AP-017 | Handler calls publisher back synchronously | Handler of event E `calls` the deployable that emits E | warn | Use a reply event | – |
| AP-018 | Unlabelled call | `calls` without `label` or `protocol` (helps agents) | info | Prompt for a label | – |

### 11.6 Stack anti-patterns (RNP)

| ID | Anti-pattern | Detection | Scope | Sev. | Quick fix |
|---|---|---|---|---|---|
| RNP-001 | Shared tables between services | ≥2 Node deployables `write` the same `pg.schema`/`pg.table` (lifted). Separate databases or schemas on one cluster are fine. | model + analysis | warn | Own schema per service; data via API/events |
| RNP-002 | Several migration owners | ≥2 `migrates` edges to one schema; analysis: two packages' migrations touch the same tables | model + analysis | error | Pick one owner; others read via a view or API |
| RNP-003 | DB client in the frontend bundle | `pg`, `postgres`, `@prisma/client`, `drizzle-orm`, `typeorm`, `knex`, `kysely` reachable in the import graph from a `react.app` package | analysis | error | Move code to Node; share only types / zod |
| RNP-004 | Secrets exposed to the browser | `VITE_*` / `REACT_APP_*` names containing `DATABASE`, `DB_`, `SECRET`, `PRIVATE`, `SERVICE_ROLE`, `PASSWORD`, `TOKEN` | analysis | error | Move to server env; add an endpoint |
| RNP-005 | Route handler uses the ORM directly | `node.route-handler` `reads`/`writes` `pg.*` with no use case/repository in between; analysis: controller file imports the ORM client | model + analysis | warn | Insert use case + repository |
| RNP-006 | Domain depends on the ORM | `node.domain` depends on a repository/ORM; analysis: domain `codePaths` import `@prisma/client` / `drizzle-orm` | model + analysis | warn | Add a port |
| RNP-007 | Dual write | Deployable `writes` Postgres and `calls` external / `publishes` to `gen.other-broker`, with no outbox and no `enqueues` with `inTransaction: true` | model | warn | Outbox template, or enqueue in the same transaction (pg-boss / graphile-worker) |
| RNP-008 | Slow work in the request path | Sync chain from a `node.route-handler` to an element with `qualities.slow`, or responsibilities matching `/export|report|batch|import|email/i`, with no worker | model | info | Move to `pg.job-queue` + `node.worker` |
| RNP-009 | No pooling at scale | `node.service` with `scaling: horizontal \| serverless` and no `connects-via` pooler | model | warn | Add PgBouncer (transaction mode) or a managed pooler |
| RNP-010 | NOTIFY used for durable work | `pg.channel` listened to by a `node.worker` | model | info | NOTIFY is not durable; use `pg.job-queue` |
| RNP-011 | Frontend calls many services | `react.app` `calls` > 2 Node deployables | model | warn | Add a Node BFF (T5) |
| RNP-012 | Server data in the client store | `react.api-client` → `react.client-store` write path while a `react.server-state` exists; analysis: `createAsyncThunk` or fetch inside Zustand actions with TanStack Query present | model + analysis | info | Keep server data in the server-state cache |
| RNP-013 | FSD layer direction | Lower FSD layer imports a higher one (`app > pages > widgets > features > entities > shared`) | model + analysis | warn | Move code down; invert via props/slots |
| RNP-014 | Feature-to-feature imports | `react.feature` depends on another `react.feature` | model + analysis | warn | Lift shared code to `entities`/`shared` |
| RNP-015 | No validation at the boundary | `node.route-handler` without `validation`; analysis: no zod / joi / class-validator / type provider found | model + analysis | info | Add schema validation; share zod via `node.contract` |
| RNP-016 | Public service without auth | Path actor → Node deployable with no auth middleware / `authenticates-with` | model | warn | Add auth middleware or gateway |
| RNP-017 | FK without index | Table FK columns without a matching index (from schema or introspection) | analysis | info | Add an index (migration snippet) |
| RNP-018 | Cycles between Node modules | Import cycle between `node.module` `codePaths` (NestJS `forwardRef` is a hint) | analysis | warn | Extract a shared module, or use events |

### 11.7 Suppressions

- A finding can be suppressed **only with a reason** (dialog, min 10
  characters), optionally linked to a decision (ADR).
- Stored in `settings.suppressions` and matched by `ruleId` + sorted `targetIds`.
- A suppressed finding stays in the Problems panel (collapsed, gray) and in
  exports under "Known issues", so agents do not "fix" accepted exceptions.

### 11.8 Visual marking

- Shape: colored halo (red / amber / blue) + badge with the count.
- Edge: red or amber dashed overlay.
- Hover: tooltip with title + one-line message. Click: opens the finding in
  the Problems panel with the rationale, the evidence links, and the quick fixes.
- Quick fix: a preview overlay (change-set style) before **Apply**. Apply is
  one undo step.

---

## 12. Templates

### 12.1 Format

```ts
interface Template {
  id: string;                  // "rnp.hexagonal-service"
  code: string;                // "T3"
  version: string;             // semver
  name: string;
  category: 'backend' | 'frontend' | 'fullstack' | 'integration';
  summary: string;
  whenToUse: string[]; whenNotToUse: string[]; tradeoffs: string[];
  parameters: TemplateParam[];
  rulePacks: string[];
  invariants: string[];        // MUST / MUST NOT sentences with {param} placeholders; exported to agents
  folderLayout?: Record<string, string>;   // element role → path pattern with {param}; feeds codePaths + enforcement
  build(params, ctx: { existingIds: Set<Id>; parentId?: Id; origin: { x: number; y: number } }): { ops: Op[]; rootIds: Id[] };
}

type TemplateParam =
  | { key: string; label: string; type: 'string'; default: string }
  | { key: string; label: string; type: 'number'; default: number; min?: number; max?: number }
  | { key: string; label: string; type: 'enum'; options: string[]; default: string }
  | { key: string; label: string; type: 'string[]'; default: string[] };
```

- **New project from template:** `build()` on an empty project.
- **Stamp into a canvas:** parameter dialog → `build()` with `parentId` (often a
  new `group.context`) and the drop position → one undo step. `derivedFrom` is
  added to the project. The template's rule packs are switched on (the user can
  turn them off).
- **Layout:** templates set positions directly (hand-tuned grids). No ELK call
  is needed.
- **Custom templates:** "Save selection as template" stores the selected
  elements, their internal relations, and positions as a JSON template (no
  parameters, or the name as a single parameter). Shareable as
  `*.archguide-template.json`.

### 12.2 Template set (v1)

| Code | Name | Parameters | Result | Packs |
|---|---|---|---|---|
| T1 | **Starter**: React (Vite) + Express REST + Postgres (Prisma) | appName, apiName, dbName | `gen.actor` → `react.app` (routes: home) → `calls` `node.service` (express) → `writes`/`reads` `pg.database` › `pg.schema public`; `migrates` | core, frontend |
| T2 | **Layered Node API** | serviceName, entities[] | `node.service` with `node.route-handler` → `node.use-case` → `node.repository` → schema; one set per entity | core, layered |
| T3 | **Hexagonal Node service** | serviceName, aggregate, orm | HTTP adapter (`node.route-handler`) → `node.use-case` → `node.domain`; `node.port` ← `node.repository` (`implements`) → schema | core, hexagonal |
| T4 | **NestJS modular monolith** | appName, modules[] | `node.service` (nestjs) › `node.module` × n, each with public API; one `pg.database`, one `pg.schema` per module, `migrates` from its module only | core, modular-monolith |
| T5 | **React + Node BFF** | services[] | `react.app` → `node.bff` → `node.service` × n; each with its own schema | core, microservices, frontend |
| T6 | **Node services, database per service** | services[], gateway | `gen.gateway` → `node.service` × n → own `pg.database` in one `pg.cluster`; `pg.job-queue` for async | core, microservices |
| T7 | **Background jobs on Postgres** | apiName, jobs[], lib | `node.service` `enqueues` (inTransaction) → `pg.job-queue` ← `processes` `node.worker` → schema / `gen.external` | core, event-driven |
| T8 | **Transactional outbox on Postgres** | serviceName, events[] | service writes data + `outbox` table (one transaction) → relay `node.worker` → `pg.job-queue` / `gen.other-broker` → consumers | core, event-driven |
| T9 | **CQRS-lite on Postgres** | serviceName, readModels[] | write tables → projector worker → `pg.view` (materialized) / projection tables → read API | core, cqrs |
| T10 | **Realtime** | appName | `react.app` ↔ `node.ws-gateway` (socket.io); service `notifies` `pg.channel` ← `listens` gateway; durable work via job queue | core, event-driven |
| T11 | **Feature-Sliced React app** | appName, features[] | `react.app` › `group.layer` (app, pages, widgets, features, entities, shared) › `react.feature` × n; `react.server-state` + `react.api-client` | frontend, fsd |
| T12 | **Type-safe monorepo** | api: `trpc` \| `openapi` | `react.app` → `react.api-client` (trpc/openapi) → `node.service`; `node.contract` (zod) used by both; Drizzle → Postgres | core, frontend |
| T13 | **Multi-tenant SaaS** | strategy: `rls` \| `schema-per-tenant` | `rls`: one schema with `rls: true` + tenant middleware; `schema-per-tenant`: schema template + tenant resolver | core, security |

### 12.3 Example: T3 invariants and folder layout

```ts
invariants: [
  '{serviceName}/domain MUST NOT import @prisma/client, drizzle-orm, express, fastify or any adapter.',
  'Persistence MUST go through a node.port; node.repository implements it.',
  'node.route-handler MUST call a node.use-case, never a node.repository.',
],
folderLayout: {
  'node.domain':        'services/{serviceName}/src/domain/**',
  'node.use-case':      'services/{serviceName}/src/application/**',
  'node.port':          'services/{serviceName}/src/domain/ports/**',
  'node.repository':    'services/{serviceName}/src/adapters/db/**',
  'node.route-handler': 'services/{serviceName}/src/adapters/http/**',
}
```

`folderLayout` fills `codePaths`. The user can edit them. If a repo scan
finds other paths, the scan suggests updating them.

---

## 13. Web application

### 13.1 Screen layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ◧ Shop ▾   View: Container ▾   Change set: — ▾    [● 2 ▲ 3 ℹ 1] [Export ▾] │
├──────────┬────────────────────────────────────────────────────┬────────────┤
│ Palette  │                                                    │ Inspector  │
│ [search] │                     Canvas                         │ Name       │
│ Basic|Full                                                    │ Kind       │
│ Frontend │          (React Flow, minimap, controls)           │ Layer      │
│ Backend  │                                                    │ Tech       │
│ Data     │                                                    │ Properties │
│ Infra    │                                                    │ Code paths │
│ Events   │                                                    │ Notes      │
│ Groups   │                                                    │ Findings   │
│ Templates│                                                    │ Evidence   │
├──────────┴────────────────────────────────────────────────────┴────────────┤
│ Problems │ Notes │ Decisions │ Change set │ Analysis review                   │
└────────────────────────────────────────────────────────────────────────────┘
```

Routes: `/` (workspace: project list, "New from template", "Open folder"),
`/p/:projectId/:viewId?`, `/settings`.

### 13.2 Stores

```ts
// projectStore (Zustand + Immer)
{ project: Project | null; dispatch(ops: Op[], meta?: { label: string; mergeKey?: string }): OpError[];
  selection: Id[]; activeViewId: Id; activeChangeSetId?: Id }

// historyStore
{ past: { label: string; inverse: Op[]; ops: Op[] }[]; future: ...; undo(); redo() }
// mergeKey merges rapid ops (e.g. a drag) into one step

// uiStore
{ paletteMode: 'basic' | 'full'; colorBy: ...; filters: ...; focusId?: Id; panels: ...; theme: 'light' | 'dark' | 'system' }

// findingsStore (from rules worker)
{ byTarget: Map<Id, Finding[]>; all: Finding[]; running: boolean }
```

`dispatch` = `validateOps` → `applyOps` → push history → schedule autosave →
post to the rules worker → (serve mode) send ops over WebSocket.

### 13.3 React Flow integration

- **View ↔ React Flow:** `nodes` and `edges` are derived with selectors from
  `project.model` + the active view. React Flow is controlled. `onNodesChange`
  position changes → `setViewNode` ops (merged per drag via `mergeKey`).
- **Custom node:** one `ShapeNode` component. It reads the concept → shape →
  SVG, label, icon, badges. Groups (`container` shape, `pg.schema`,
  `pg.cluster`) are React Flow parent nodes (`parentId`, `extent: 'parent'`
  off, so you can drag children out).
- **Custom edge:** `RelationEdge` with style from the relation type, label,
  and finding overlay. Smooth-step path by default. Waypoints are supported.
- **`isValidConnection`:** calls `validRelationTypes()`. Returns `false` when the
  list is empty.
- **During connect** (`onConnectStart`): compute valid target IDs once. Add the
  class `ag-target-valid` (glow) or `ag-target-invalid` (30% opacity) to the nodes.
- **`onConnect`:** apply the smart default (§10.5).
- **`onConnectEnd` on empty canvas:** open quick-add filtered to valid targets.
  Create the element and the relation in one step.
- **Nesting:** `onNodeDragStop` → find the innermost group under the pointer →
  `checkNesting()` → `moveElement` op, or a refusal toast + snap back.
- **Drill-down:** double-click a deployable or `pg.database` → open (or create)
  a view with `scopeElementId`. Breadcrumbs show the path.

### 13.4 Panels

| Panel | Content |
|---|---|
| Palette | Search (fuzzy, by name, alias, tech: "prisma" finds Repository), groups, Basic/Full, drag sources, Templates tab |
| Inspector | Form generated from the concept `propertySchema` + common fields; code paths with "open" links (vscode://file, or a copy button); Markdown notes; findings for the selection; evidence list; for relations: type (only valid types), protocol, label, contract |
| Problems | Grouped by severity and rule; filter; click → select + zoom; quick fixes; suppress |
| Notes | Project notes (Markdown pages), list + editor, links to elements via `@id` mentions |
| Decisions | ADR list + editor, status, links |
| Change set | Ops list (human readable), status, tasks, "Export plan" |
| Analysis review | Inferred items grouped by detector, confidence, evidence; Accept / Edit / Reject per item or in bulk |

### 13.5 Interactions and shortcuts

| Action | Shortcut |
|---|---|
| Command palette | `Ctrl/Cmd + K` or `/` |
| Quick add at cursor | Double-click canvas, or `A` |
| Rename selected | `Enter` or `F2` |
| Connect mode from selected | `C`, then click the target |
| Delete | `Delete` / `Backspace` |
| Undo / redo | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` |
| Copy / paste / duplicate | `Ctrl/Cmd + C` / `V` / `D` |
| Group selection | `Ctrl/Cmd + G` (choose group kind) |
| Auto-layout | `Ctrl/Cmd + L` |
| Focus mode | `F` |
| Zoom to fit | `Shift + 1` |
| Validate now | `Ctrl/Cmd + Shift + V` |
| Export | `Ctrl/Cmd + E` |

Commands in the palette, for example: `add service Orders`, `apply template
hexagonal`, `connect app.web svc.bff`, `color by owner`, `export agent-md`,
`new change set "Add payments"`.

Other features: multi-select (box and `Shift`), align/distribute, snap to
grid (8 px), minimap, focus mode (dim everything not connected to the
selection, depth 1–3), filter by tag/layer/status/owner, dark mode.

**Onboarding:** the first run opens T1 (Starter) with three tips: drag a shape,
connect two shapes, open Problems.

### 13.6 Undo / redo

- Every `dispatch` stores `{ ops, inverse }`.
- Undo dispatches the `inverse` ops without recording them. Redo dispatches the `ops` again.
- In serve mode, undo sends normal ops to the server (no special protocol).
- History holds 200 steps per project session.

### 13.7 Auto-layout

`layout.worker.ts` runs ELK `layered` (direction `RIGHT`), with
`elk.hierarchyHandling: INCLUDE_CHILDREN` so groups stay intact. The layer of
an element becomes an ELK partition (presentation left → data right). The result is
`setViewNode` ops (one undo step).

### 13.8 Views

- `free` (default), `context` (deployables + actors + externals only), `container`
  (deployables + data), `component` (inside one deployable), `database`
  (inside one `pg.database`: schemas + tables + ownership colors), `scenario`.
- A new element is added to the active view only. "Show in view…" adds it to
  other views.
- **Database view:** tables come from analysis (Prisma/Drizzle/SQL or live
  introspection) or manual entry. FKs are drawn as thin edges. Tables are
  colored by the service that `writes` them. Tables written by 2+ services
  get a red outline (RNP-001).
- **Scenario view:** select a start element → "Record scenario" → click the
  relations in order → steps with notes. Play shows the steps one by one.
  Export to a Mermaid `sequenceDiagram`. AP-007 / RNP-008 are checked along the path.

### 13.9 Accessibility and quality

- All panels use keyboard navigation (Radix). The canvas has a hidden "outline"
  list (tree of elements and relations) for screen readers and keyboard users.
- Color is never the only signal: shapes, icons, line styles and badges carry
  the same meaning.
- Performance budget: 500 nodes / 1,000 edges → pan/zoom at 60 fps
  (`onlyRenderVisibleElements`, memoized nodes).

---

## 14. Persistence, projects and sync

### 14.1 Storage modes

| Mode | When | Where data lives |
|---|---|---|
| **Browser** (default) | No folder opened | IndexedDB (Dexie) |
| **Folder** | "Open folder" (Chromium, File System Access API) | `architecture/` files; IndexedDB as cache |
| **Serve** | `archguide serve` | Files, owned by the local server; browser talks over WebSocket |

### 14.2 Dexie schema

```ts
db.version(1).stores({
  projects: 'id, name, updatedAt',        // full Project JSON
  snapshots: 'id, projectId, createdAt',  // full Project JSON
  handles: 'id',                          // FileSystemDirectoryHandle (persisted)
  prefs: 'key',
});
```

### 14.3 Autosave

- Debounced 500 ms after the last op, max wait 5 s.
- Browser mode: write to Dexie.
- Folder mode: write the file with `createWritable()`. Keep a Dexie copy for
  crash recovery.
- Serve mode: the server saves (see 14.5).
- Status in the top bar: "Saved", "Saving…", "Offline copy only", "Conflict".

### 14.4 Projects and snapshots

- Workspace page: list, search, "New" (empty / template / import), duplicate,
  delete (with confirm), "Open folder".
- **Snapshot:** a named full copy at a revision. Stored in Dexie, or in
  `.archguide/snapshots/<project>/` in folder/serve mode.
- **Compare:** pick two snapshots (or snapshot vs current) → diff (§16.3) →
  shown as an overlay like a change set.
- **Import:** native JSON (with migration), template JSON, Mermaid flowchart
  (subset: nodes, edges, subgraphs → `gen.*` concepts, then the user retypes
  them), Structurizr DSL (subset: software systems, containers, components,
  relationships).

### 14.5 Serve mode and conflicts

`archguide serve` (package `server`):

- Fastify on `127.0.0.1:<port>` (default 4317). It serves the built web app.
- A random session token is printed in the URL (`http://127.0.0.1:4317/?t=…`)
  and required for WebSocket and HTTP calls.
- WebSocket protocol (JSON messages):

```ts
// client → server
{ t: 'hello'; projectId: Id }
{ t: 'ops'; projectId: Id; baseRevision: number; ops: Op[]; clientOpId: string }
// server → client
{ t: 'state'; project: Project }                                  // on hello and after an external change
{ t: 'applied'; clientOpId: string; revision: number }
{ t: 'ops'; projectId: Id; revision: number; ops: Op[]; origin: 'mcp' | 'cli' | 'client' | 'file' }
{ t: 'rejected'; clientOpId: string; errors: OpError[] }
```

- **Single writer:** the server is the only writer of the files while it runs.
  The MCP server and the CLI detect a running server (lock file
  `architecture/.archguide/server.json` with port + token + pid) and send their
  ops to it over HTTP (`POST /api/projects/:id/ops`). The open browser then
  updates live.
- **No server running:** MCP and CLI write files directly: read → check
  `revision` → apply → atomic write (temp file + rename) → `revision + 1`.
- **External edits** (git checkout, editor): `chokidar` sees the change → the server
  reloads → broadcasts `state`. If the browser has unsent ops, it shows
  "The file changed outside the app. Reapply your changes / Discard".
- **Revision conflict:** ops are re-validated against the newest revision. If
  they are still valid, they are applied (ops are small and ID-based, so this
  usually works). Otherwise, `REVISION_CONFLICT` with the details.

---

## 15. Notes, annotations and decisions

| Feature | Where | Data |
|---|---|---|
| Element / relation notes | Inspector, Markdown | `Element.notes`, `Relation.notes` |
| Sticky notes | Canvas, free position | `Annotation.kind = 'sticky'` |
| Callouts | Anchored to an element/relation, leader line, moves with it | `kind = 'callout'` |
| Regions | Colored, titled rectangle behind elements ("Phase 2 scope") | `kind = 'region'` |
| Comments | Threaded, resolvable (single user in v1) | `kind = 'comment'`, `replies` |
| Project notes | Notes panel, Markdown pages; `@id` mentions link elements | `Note` |
| Decisions (ADRs) | Decisions panel; a badge on linked shapes | `Decision` |

- Mentions: typing `@` in any Markdown field opens an element picker and
  inserts `@svc.orders`. In the UI it renders as a link. In exports it stays as
  the ID.
- A glossary is a project note titled "Glossary" with a `term: definition`
  list. The agent export puts it in its own section.
- All notes, decisions and unresolved comments are exported (§17), so the agent
  gets the context too.

---

## 16. Change sets (feature planning)

### 16.1 Concept

- The **baseline** is the current model (often from a repo scan).
- A **change set** is a named list of ops on top of the baseline: the feature
  proposal.
- While a change set is active, every edit is recorded **into the change set**
  instead of the baseline. The top bar shows a colored "Editing change set: Add
  payments" bar.
- The canvas shows the overlay: added = green outline, changed = amber,
  removed = red, dashed and struck through.
- Rules run on `baseline + change set`. The Problems panel shows only **new**
  findings by default ("introduced by this change"), with a toggle for all.

### 16.2 Lifecycle

`draft` → `ready` (plan exported) → `implemented` (the ops are merged into
the baseline: "Apply to baseline") or `abandoned`.

When the baseline changes after the change set was created (`baseRevision` <
current), the ops are re-validated. Conflicts (for example, an element the
change set edits was removed) are listed and can be fixed by hand.

### 16.3 Diff

```ts
diffProjects(a: Project, b: Project): {
  added: { elements: Id[]; relations: Id[] };
  removed: { elements: Id[]; relations: Id[] };
  changed: { id: Id; fields: string[] }[];
}
```

Used for: change set overlay (baseline vs baseline+ops), snapshot comparison,
analyzer drift (§18.6).

### 16.4 Task generation

`generateTasks(baseline, changeSet)`:

1. Collect the added and changed elements. Removals become "Remove X" tasks
   at the end.
2. Build a dependency graph over them. An edge `A → B` means "A needs B to
   exist first" (A `reads`/`writes`/`calls`/`implements`/`uses-port`/`depends-on`/
   `enqueues`/`processes` B, or B is A's parent).
3. Topological sort. Ties are broken by category rank:
   `data-at-rest (schema, table) → data-in-motion → port → domain → adapter
   (repository) → use case → route handler → deployable → BFF/gateway → frontend`.
4. One task per element. Its added relations become sub-steps ("Expose
   `POST /checkout/pay`", "Enqueue `payment.succeeded` in the same transaction").
5. Each task gets the matching invariants (template invariants + rules on
   the involved elements) and the `codePaths`.
6. Cycles in step 2 (rare) are put in one combined task, with a note.

The user can edit, merge, reorder and tick off tasks.

### 16.5 Change-set plan export

See §17.4.

---

## 17. Exporters

All exporters live in `core/export`. They are pure functions
`(project, options) → { files: { path: string; content: string }[] }`.
They are available in the UI (Export dialog), the CLI and MCP.

| Format ID | Output | Notes |
|---|---|---|
| `json` | `<id>.archguide.json` | Lossless |
| `agent-md` | `ARCHITECTURE.md` | Primary AI format (§17.2) |
| `agent-yaml` | `architecture.yaml` | Compact (§17.3) |
| `plan-md` | `plans/<cs-id>.md` | Change-set plan (§17.4) |
| `speckit` | `specs/<n>-<slug>/spec.md`, `plan.md`, `tasks.md` | GitHub Spec Kit layout (R4) |
| `kiro` | `.kiro/specs/<slug>/requirements.md`, `design.md`, `tasks.md` | Kiro layout (R4) |
| `agents-snippet` | Text block for `AGENTS.md` / `CLAUDE.md` | Invariants + pointer to ARCHITECTURE.md (§17.5) |
| `dependency-cruiser` | `.dependency-cruiser.cjs` | §22 |
| `nx-constraints` | JSON for `@nx/enforce-module-boundaries` | §22 |
| `archunit` | `architecture.spec.ts` | §22 |
| `dbml` | `<db>.dbml` | Tables, FKs (R7) |
| `mermaid` | `.mmd` flowchart (and `sequenceDiagram` for scenarios) | |
| `likec4` | `.c4` | Element kinds from the catalog (R6) |
| `structurizr` | `workspace.dsl` | Software system / container / component mapping (R6) |
| `plantuml` | `.puml` (C4-PlantUML) | |
| `png` / `svg` | Image | UI only |

**Common options:** `focus?: Id`, `depth?: number` (neighborhood: BFS over
relations up to `depth`, plus ancestors and children of the focus),
`includeNotes` (default true), `includeLayout` (json only), `changeSetId?`.

### 17.1 Design principles for agent formats

1. Stable IDs everywhere.
2. Tables for lists. Prose only where it adds meaning.
3. **Invariants** as MUST / MUST NOT sentences. Sources: template invariants,
   enabled rules (rendered from a sentence template per rule), layer settings,
   ownership (`ownedBy`).
4. Code locations (`codePaths`, evidence) so the agent knows where to work.
5. Known issues with suppressions and reasons.
6. No layout data. Deterministic order (by layer, then ID).
7. A front-matter block for machines. Markdown for both people and agents.

### 17.2 Agent Markdown (`agent-md`)

Section order (empty sections are left out):

1. YAML front matter: `archguide`, `project`, `profile`, `patterns`,
   `revision`, `generated`.
2. `# Architecture: <name>` + description.
3. `## Elements` table: ID, Kind, Name, Parent, Layer, Tech, Responsibilities, Code.
4. `## Relations` table: From, Relation, To, Details (label, protocol, via).
5. `## Data ownership`: schema → owner (`migrates`), writers, readers.
6. `## Invariants`: bullet list.
7. `## Known issues`: rule, where, status, reason.
8. `## Decisions`: accepted / proposed ADRs (title, one-line decision, links).
9. `## Glossary`.
10. `## Notes`.
11. `## Open change sets`: name, status, link to the plan file.

Example:

````markdown
---
archguide: 1
project: shop
profile: react-node-postgres
patterns: [hexagonal, bff]
revision: 42
generated: 2026-10-27
---

# Architecture: Shop

Online shop. The React SPA talks to a Node BFF. The Orders service follows Hexagonal.

## Elements

| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |
|---|---|---|---|---|---|---|---|
| app.web | react.app | Web SPA | – | presentation | React 19, Vite | Catalog, cart, checkout UI | apps/web/** |
| bff.web | node.bff | Web BFF | – | application | Fastify | Aggregate catalog + orders for web | apps/bff/** |
| svc.orders | node.service | Orders | – | application | NestJS | Place, cancel, track orders | services/orders/** |
| dom.order | node.domain | Order | svc.orders | domain | – | Order lifecycle invariants | services/orders/src/domain/** |
| port.order-repo | node.port | OrderRepository | svc.orders | domain | – | Persist orders | services/orders/src/domain/ports/** |
| repo.pg-orders | node.repository | PgOrderRepository | svc.orders | infrastructure | Prisma | Implements OrderRepository | services/orders/src/adapters/db/** |
| db.shop | pg.database | Shop DB | – | data | PostgreSQL 17 | – | – |
| schema.orders | pg.schema | orders | db.shop | data | – | – | services/orders/prisma/** |

## Relations

| From | Relation | To | Details |
|---|---|---|---|
| app.web | calls | bff.web | http, `GET /catalog`, `POST /orders` |
| bff.web | calls | svc.orders | http, `POST /orders` |
| repo.pg-orders | implements | port.order-repo | – |
| repo.pg-orders | writes | schema.orders | via prisma |
| svc.orders | migrates | schema.orders | prisma-migrate |

## Data ownership

| Schema | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.orders | svc.orders | svc.orders | svc.orders |

## Invariants

- `dom.*` MUST NOT import `@prisma/client`, `drizzle-orm`, `express`, `fastify` or `repo.*`. (hexagonal)
- `app.web` MUST only call `bff.web`. (bff)
- Only `svc.orders` MAY write `schema.orders`. Only `svc.orders` MAY run migrations on it. (RNP-001, RNP-002)
- Browser code (`apps/web/**`) MUST NOT import database clients. (RNP-003)
- New persistence in `svc.orders` MUST go through a port in `services/orders/src/domain/ports`.

## Known issues

| Rule | Where | Status | Reason |
|---|---|---|---|
| RNP-015 No validation at the boundary | ctl.legacy-import | suppressed | Internal endpoint, removed in Q1 (adr-004) |

## Decisions

- **adr-004** (accepted): Keep the legacy import endpoint until Q1. Links: ctl.legacy-import.

## Glossary

- **Order**: a confirmed cart. Drafts are **Carts**.
````

### 17.3 Agent YAML (`agent-yaml`)

```yaml
archguide: 1
project: shop
profile: react-node-postgres
elements:
  - { id: app.web, kind: react.app, name: Web SPA, layer: presentation, code: [apps/web/**] }
  - { id: svc.orders, kind: node.service, name: Orders, tech: NestJS, code: [services/orders/**] }
  - { id: schema.orders, kind: pg.schema, parent: db.shop, ownedBy: svc.orders }
relations:
  - [app.web, calls, bff.web, { protocol: http }]
  - [repo.pg-orders, writes, schema.orders, { via: prisma }]
invariants:
  - "dom.* MUST NOT import @prisma/client, drizzle-orm, express, fastify or repo.*"
known_issues:
  - { rule: RNP-015, targets: [ctl.legacy-import], reason: "Internal endpoint, removed in Q1" }
```

Relations use the tuple form `[from, type, to, {props}]` to save tokens.

### 17.4 Change-set plan (`plan-md`)

````markdown
---
archguide: 1
project: shop
changeSet: cs.add-payments
status: ready
baseRevision: 42
---

# Plan: Add Stripe payments

> Users pay for an order with a card. Orders become "paid" after the Stripe webhook.

## Changes

| Op | Item | Details |
|---|---|---|
| ADD | svc.payments (node.service) | NestJS; "Create payment intents, handle Stripe webhooks"; code: services/payments/** |
| ADD | schema.payments (pg.schema) | in db.shop; ownedBy svc.payments |
| ADD | ext.stripe (gen.external) | Stripe API |
| ADD | jobs.payments (pg.job-queue) | pg-boss; queue `payment.succeeded` |
| ADD | svc.payments calls ext.stripe | https |
| ADD | svc.payments enqueues jobs.payments | inTransaction: true |
| ADD | svc.orders processes jobs.payments | marks order paid |
| CHANGE | bff.web | add route `POST /checkout/pay` |

## Invariants this change must respect

- `svc.payments` MUST own `schema.payments` and MUST NOT write `schema.orders`. (RNP-001)
- `payment.succeeded` MUST be enqueued in the same transaction as the payment row. (RNP-007)
- `app.web` MUST call `bff.web` only. (bff)

## Rule check (baseline + change)

- Errors: 0
- Warnings: 0
- Info: 1 — AP-012 Missing dead-letter handling on `jobs.payments`.

## Tasks

1. **Create schema.payments**: Prisma schema + first migration in `services/payments/prisma`.
2. **Create jobs.payments**: register pg-boss queue `payment.succeeded`.
3. **Create svc.payments** (template T3 Hexagonal): `PaymentGateway` port, Stripe adapter, `CreatePaymentIntent` use case, webhook handler.
   - Enqueue `payment.succeeded` inside the payment transaction.
4. **Change svc.orders**: worker handler for `payment.succeeded` → mark order paid.
5. **Change bff.web**: `POST /checkout/pay` → `svc.payments`.
6. Run `archguide check`.
````

### 17.5 `AGENTS.md` / `CLAUDE.md` snippet

```markdown
## Architecture
The architecture model is in `architecture/shop.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules (enforced by `archguide check` in CI):
- dom.* MUST NOT import @prisma/client, drizzle-orm, express, fastify or repo.*
- Browser code (apps/web/**) MUST NOT import database clients.
- Only svc.orders MAY write or migrate schema.orders.
After a structural change, update the model (MCP tool `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
```

### 17.6 Spec Kit and Kiro layouts

| Section | Spec Kit file | Kiro file | Content |
|---|---|---|---|
| Feature request, goals | `spec.md` | `requirements.md` | Change set description; acceptance criteria from tasks (Kiro: EARS-style "WHEN … THE SYSTEM SHALL …" sentences generated from added relations) |
| Architecture of the change | `plan.md` | `design.md` | Changes table, invariants, affected elements subset of agent-md, Mermaid diagram of the changed neighborhood, rule check |
| Tasks | `tasks.md` | `tasks.md` | Checkbox list from §16.4, with code paths |

### 17.7 Interop formats

- **Mermaid:** `flowchart LR`; groups → `subgraph`; shapes mapped to Mermaid
  shapes (cylinder `[( )]`, hexagon `{{ }}`, diamond `{ }`, circle `(( ))`); async
  relations as dotted links `-.->`.
- **LikeC4:** `specification` block generated from the catalog (element kinds,
  relationship kinds); `model` block with nesting; one `view` per project view.
- **Structurizr DSL:** deployables → `container`, inner elements →
  `component`, data → `container` with tag `Database`, actors → `person`,
  externals → `softwareSystem` with tag `External`.
- **DBML:** `Table schema.table { ... }` with `Ref:` for FKs. Notes: owner service.

---

## 18. Repository analyzer

### 18.1 Goal

Produce a **draft model with evidence** from a React / Node / Postgres repository,
locally, without running any repository code. An agent or a person then reviews
it.

### 18.2 Pipeline

```
discover → engines → detectors → resolve → match → result
```

1. **discover:** find the repo root, read `.gitignore`, list workspace packages
   (`package.json` `workspaces`, `pnpm-workspace.yaml`), detect Turborepo/Nx,
   list files (`fast-glob` with `ignore`), apply `include` / `exclude` /
   `maxFiles` / max file size (1 MB).
2. **engines** (lazy, cached per run):
   - `depcruise`: `cruise(packages, { tsConfig, combinedDependencies, exclude })` →
     module graph (also gives cycles and resolved `node_modules` targets);
   - `tsmorph`: one `Project` per package, `skipFileDependencyResolution`, files
     added on demand;
   - `prisma`: parse each `schema.prisma`;
   - `sql`: parse `.sql` migrations with `libpg-query`;
   - `compose`: parse `docker-compose*.yml`;
   - `env`: parse `.env*` (names only; **values are never read into results**,
     except `localhost:<port>` URL shapes needed to match services).
3. **detectors:** each detector returns facts.
4. **resolve:** facts → candidate elements and relations (IDs, kinds, names,
   parents, `codePaths`, confidence, evidence).
5. **match:** candidates vs the existing model → `AnalysisDiff`.
6. **result:** `AnalysisResult`, written to `.archguide/analysis/last.json`.

### 18.3 Types

```ts
interface Detector {
  id: string;                          // "react.router"
  profile: string;
  appliesTo(pkg: PackageInfo): boolean;
  run(ctx: DetectorContext): Promise<Fact[]>;
}

interface DetectorContext {
  repoRoot: string; pkg: PackageInfo; packages: PackageInfo[];
  files: string[];                                  // in this package, filtered
  depGraph(): Promise<DepGraph>;
  ts(): Project;                                    // ts-morph
  readText(path): Promise<string>;
  prisma(path): PrismaSchema; sql(path): SqlAst; compose(): ComposeFile[]; env(): EnvVar[];
}

interface Fact {
  type: 'package' | 'deployable' | 'framework' | 'route' | 'handler' | 'middleware' | 'module'
      | 'layer-folder' | 'state' | 'api-client' | 'http-call' | 'external-sdk'
      | 'db-schema' | 'db-table' | 'db-fk' | 'db-index' | 'migrations' | 'orm-usage'
      | 'job-producer' | 'job-consumer' | 'notify' | 'listen' | 'compose-service'
      | 'env-var' | 'import-violation' | 'cycle';
  subject: string;                     // stable key, e.g. "pkg:services/orders", "table:orders.order"
  data: Record<string, unknown>;
  evidence: { path: string; line?: number; symbol?: string }[];
  confidence: number;                  // 0..1
  detector: string;
}

interface AnalysisResult {
  repoRoot: string; analyzedAt: Iso; durationMs: number;
  stats: { files: number; packages: number; facts: number };
  facts: Fact[];
  candidates: Model;                   // origin: 'inferred'
  diff?: AnalysisDiff;
  warnings: string[];                  // limits hit, parse errors
}

interface AnalysisDiff {
  newInCode: Id[];                     // candidates with no model match
  missingInCode: Id[];                 // model elements (status existing) with no candidate match
  changed: { id: Id; fields: string[] }[];
  suggestedOps: Op[];                  // to bring the model in line with the code
}
```

### 18.4 Detectors (profile `react-node-postgres`)

**Workspace and packages**

| Detector | Signal | Facts → result |
|---|---|---|
| `ws.packages` | Workspace manifests | `package` per package |
| `ws.react-app` | deps `react` + `vite`, `index.html`, `vite.config.*` | `deployable` → `react.app` |
| `ws.node-service` | deps `express` / `fastify` / `@nestjs/core` + `listen(` / `NestFactory.create` | `deployable` → `node.service` (framework) |
| `ws.worker` | `pg-boss` `.work(` or graphile-worker `run(` / `tasks/` without an HTTP listen | `deployable` → `node.worker` |
| `ws.libs` | Package imported by others, no entry point; exports zod / OpenAPI / tRPC router | `node.shared-lib` / `react.design-system` / `node.contract` |

**React**

| Detector | Signal | Result |
|---|---|---|
| `react.router` | `createBrowserRouter([...])` route objects, `<Route path>` JSX, TanStack Router `createFileRoute` / `src/routes/**` | `react.route`, `react.layout` (paths, lazy) |
| `react.fsd` | Folders `app/ pages/ widgets/ features/ entities/ shared/` | `react.feature` + `fsdLayer` |
| `react.state` | `@tanstack/react-query`, `swr`, RTK Query, `@apollo/client`; `zustand` `create(`, `configureStore`, `createContext` | `react.server-state`, `react.client-store` |
| `react.api-client` | `axios.create({ baseURL })`, a module that wraps `fetch`, generated OpenAPI clients, `createTRPCProxyClient` / `createTRPCReact` | `react.api-client` (kind) |
| `react.backend-link` | `vite.config` `server.proxy` targets (read **statically** with ts-morph), `VITE_API_URL` in `.env*` | `http-call` from `react.app` to the service matched by port / compose name |

**Node.js**

| Detector | Signal | Result |
|---|---|---|
| `node.express` | `express()`, `Router()`, `app.use('/p', r)`, `r.get/post/...` | `node.route-handler` per router file with route list (mount prefixes joined) |
| `node.fastify` | `fastify()`, `register(plugin, { prefix })`, `.get/.post/.route({})` | same |
| `node.nest` | `@Module({ imports, controllers, providers, exports })`, `@Controller('p')`, `@Get()` … | exact `node.module` graph (`depends-on`), handlers, providers |
| `node.middleware` | `passport`, `express-jwt`, `@nestjs/passport`, `@fastify/jwt`, Clerk / Auth0 SDKs | `node.middleware(auth)` + `gen.auth-provider` |
| `node.validation` | `zod`, `joi`, `class-validator`, `@fastify/type-provider-*` used in handler files | `validation` property |
| `node.external-sdk` | `stripe`, `@sendgrid/mail`, `@aws-sdk/*`, `@anthropic-ai/sdk`, `openai`, `twilio`, … (lookup table) | `gen.external` + `calls` |
| `node.http-calls` | `fetch(`/axios with base URL from env vars that match another service | `calls` between services |
| `node.layers` | Folders `domain/ application/ use-cases/ adapters/ ports/ infra/ repositories/ controllers/` | layer tags; candidates `node.domain`, `node.port`, `node.repository`, `node.use-case` |

**PostgreSQL**

| Detector | Signal | Result |
|---|---|---|
| `pg.prisma-schema` | `schema.prisma` with `provider = "postgresql"`; `@@schema`, `@@map`, models, relations | `pg.database`, `pg.schema`, `pg.table` + FKs |
| `pg.drizzle-schema` | `pgTable(`, `pgSchema(` (ts-morph) | same |
| `pg.typeorm` | `@Entity(`, `@ManyToOne` … | same |
| `pg.sql` | `CREATE TABLE/INDEX/SCHEMA` in `.sql` migrations (libpg-query) | same + indexes |
| `pg.migrations` | `prisma/migrations/`, `drizzle/`, `migrations/` (node-pg-migrate, knex, TypeORM) per package | `migrations` → `migrates` |
| `pg.orm-usage` | Prisma: `prisma.<model>.<method>(` (read: `find*`, `count`, `aggregate`, `groupBy`; write: `create*`, `update*`, `upsert`, `delete*`); Drizzle: `db.select().from(t)`, `db.insert(t)`, `db.update(t)`, `db.delete(t)`; TypeORM repositories; Kysely `selectFrom/insertInto` | `orm-usage` → **data ownership map** |
| `pg.jobs` | pg-boss `send(` / `work(` / `schedule(`; graphile-worker `addJob(` / task names | `pg.job-queue`, `enqueues` (with `inTransaction` when inside `prisma.$transaction` / `db.transaction` callback), `processes` |
| `pg.notify` | `LISTEN` / `NOTIFY` / `pg_notify(` in SQL or `client.query` | `pg.channel`, `listens`, `notifies` |
| `infra.compose` | `postgres`, `pgbouncer`, Node service images, ports, `depends_on` | `pg.cluster`, `pg.pooler`, port map for matching |
| `infra.env` | `DATABASE_URL`-style names per package, browser-exposed names | `env-var` (RNP-004) |

### 18.5 Data ownership algorithm

```
for each deployable package P:
  for each orm-usage fact in P:  (model/table T, op ∈ {read, write})
    resolve T to (schema, table) via @@map / @@schema / pgTable name
    acc[P][T] |= op
for each (P, T): emit relation P -reads|writes-> table T  (or schema-level if tables are hidden)
for each schema S:
  owners = packages with a migrations fact touching tables in S
  if owners.length == 1: S.properties.ownedBy = owners[0]; emit owners[0] -migrates-> S
  if owners.length > 1: emit RNP-002 analysis finding
writers(S) > 1 across deployables → RNP-001 analysis finding (with evidence lines)
```

Lifting (§11.2) shows the result at service level in container views and at
table level in the database view.

### 18.6 Resolve and match

- **Resolve:** one candidate element per fact `subject`. IDs come from
  `idPrefix + slug(name)`. Parents come from file location (a handler file
  inside a package → that package's deployable). Confidence for an element is
  `1 − Π(1 − cᵢ)` over its facts (noisy-or), capped at 0.99.
- **Match** to the existing model (per candidate, first rule that hits):
  1. same `id`;
  2. overlapping `codePaths` with the same kind;
  3. same kind + same normalized name inside the same parent.
- **Diff:** `newInCode`, `missingInCode`, `changed` (fields that differ:
  routes, tech, parent …), and `suggestedOps` (add inferred items with
  `origin: 'inferred'`, `reviewed: false`; never auto-remove: missing items
  become a finding "Element not found in code").

### 18.7 Live Postgres introspection (optional)

- Turned on by `--db` or `analyzer.database.urlEnv`. The URL is read from the
  environment only.
- Opens a **read-only** connection (`SET default_transaction_read_only = on`),
  runs `pg-introspection`'s catalog query against **`pg_catalog`** (not
  `information_schema`; R8), closes it.
- Produces schemas, tables, columns, FKs, indexes, RLS flags (`relrowsecurity`),
  and extensions.
- Never reads table data.

### 18.8 Limits and performance

- Default `maxFiles` 20,000, max file 1 MB, timeout 120 s (configurable).
  When a limit is hit, the result has a warning and stays partial.
- Target: a 2,000-file monorepo in < 20 s on a laptop.
- Cache: file hash → facts, in `.archguide/analysis/cache/`. A second run
  parses only changed files.

### 18.9 Review flow in the UI

The Analysis review panel lists `suggestedOps` grouped by detector, with
confidence and evidence (click → open the file at the line). **Accept** applies
the ops with `reviewed: true`. **Edit** opens the item in the Inspector first.
**Reject** stores the subject in `.archguide/analysis/rejected.json`, so the
next run does not suggest it again.

---

## 19. MCP server

Package `mcp-server`, binary `archguide-mcp`. Transport: stdio.

```bash
# Claude Code
claude mcp add archguide -- npx -y archguide-mcp --workspace ./architecture
```

Options: `--workspace <dir>` (default `./architecture`), `--repo <dir>`
(default: the workspace's `codeRoot`), `--read-only`.

### 19.1 Response envelope (all tools)

```ts
type ToolResult =
  | { ok: true; revision?: number; changed?: Id[]; findings?: Finding[]; data?: unknown; hints?: string[] }
  | { ok: false; errors: OpError[]; hints?: string[] };
```

- Write tools return **only the findings their change introduced** (`findings`)
  and a short count of all findings. The agent can fix its own mistakes right away (R1).
- Errors give `itemId`, `code`, `message`, `hint`, and a `fix` (ops) when one exists.

### 19.2 Tools

| Tool | Input (summary) | Output `data` |
|---|---|---|
| `list_projects` | – | `[{ id, name, revision, elements, relations, openChangeSets }]` |
| `get_architecture` | `projectId`, `format: 'agent-md' \| 'agent-yaml' \| 'json'` (default `agent-md`), `focus?: Id`, `depth?: number` (default 1), `changeSetId?` | text or JSON |
| `get_catalog` | `filter?: string` (kind prefix or category) | concepts (id, name, category, allowedParents, properties), relation types, compatibility pairs |
| `list_templates` | – | `[{ id, code, name, summary, parameters }]` |
| `apply_template` | `projectId`, `templateId`, `params`, `parentId?`, `changeSetId?` | created IDs |
| `create_project` | `id?`, `name`, `description?`, `templateId?`, `params?` | project summary |
| `upsert_elements` | `projectId`, `elements: Partial<Element> & { id?: Id; kind: string; name: string }[]` (max 200), `changeSetId?` | created / updated IDs (generated IDs returned) |
| `upsert_relations` | `projectId`, `relations: { id?: Id; type?: string; sourceId: Id; targetId: Id; ... }[]` (max 400), `changeSetId?`. Missing `type` → smart default; ambiguous → error listing the valid types | IDs |
| `remove_items` | `projectId`, `ids: Id[]`, `cascade?: boolean`, `changeSetId?` | removed IDs |
| `rename_id` | `projectId`, `from`, `to` | – |
| `add_note` | `projectId`, `title`, `body`, `linkedIds?` | note ID |
| `add_annotation` | `projectId`, `viewId?`, `kind`, `text`, `anchorId?` | annotation ID |
| `add_decision` | `projectId`, `title`, `status`, `context`, `decision`, `consequences`, `linkedIds?` | decision ID |
| `validate_project` | `projectId`, `changeSetId?`, `includeSuppressed?` | all findings + quick-fix titles |
| `apply_quick_fix` | `projectId`, `ruleId`, `targetIds`, `fixIndex` | changed IDs |
| `suppress_finding` | `projectId`, `ruleId`, `targetIds`, `reason`, `decisionId?` | – |
| `analyze_repository` | `path?`, `include?`, `exclude?`, `db?: boolean`, `projectId?` (to compute the diff) | summary: packages, candidate counts by kind, top facts, `diff`, warnings; full result saved to `.archguide/analysis/last.json` |
| `apply_analysis` | `projectId`, `accept: 'all' \| Id[]`, `minConfidence?` (default 0.6) | changed IDs |
| `diff_with_repository` | `projectId`, `path?` | `AnalysisDiff` + analysis-scope findings |
| `create_change_set` | `projectId`, `name`, `description` | change set ID |
| `get_change_set` | `projectId`, `changeSetId` | ops (human readable), tasks, new findings |
| `generate_tasks` | `projectId`, `changeSetId` | tasks |
| `export` | `projectId`, `format`, `changeSetId?`, `write?: boolean` (write to the configured path) | content or written paths |
| `generate_enforcement` | `projectId`, `target: 'dependency-cruiser' \| 'nx' \| 'archunit'`, `write?` | content or path |

Write tools take `changeSetId` to record into a change set instead of the baseline.

### 19.3 Resources

- `archguide://projects` (list)
- `archguide://projects/{id}` (agent-md)
- `archguide://projects/{id}/yaml`
- `archguide://projects/{id}/change-sets/{csId}` (plan-md)
- `archguide://catalog` and `archguide://catalog/{kindPrefix}`
- `archguide://rules` and `archguide://rules/{ruleId}` (rationale)
- `archguide://templates/{id}`

### 19.4 Prompts

| Prompt | Arguments | Steps it gives the agent |
|---|---|---|
| `map-repository` | `projectName?` | 1. `analyze_repository`. 2. Read the top evidence files to confirm the deployables and layers. 3. `create_project` if needed. 4. `apply_analysis` with `minConfidence 0.6`, then `upsert_*` for corrections (responsibilities, names). 5. `validate_project`; fix or `suppress_finding` with reasons. 6. `export` agent-md with `write: true`. 7. Report what is inferred and needs human review. |
| `plan-feature` | `feature` | 1. `get_architecture` (focus on the affected area). 2. `create_change_set`. 3. `upsert_*` / `apply_template` with `changeSetId`. 4. `validate_project` with `changeSetId` until no new errors. 5. `generate_tasks`. 6. `export` `plan-md` (and `speckit`/`kiro` if the repo uses them). |
| `review-change` | `baseRef?` | 1. `diff_with_repository`. 2. Report invariant violations with file and line. 3. Propose model updates or code fixes. |

### 19.5 Concurrency

Writes go through the running `archguide serve` when its lock file exists
(the browser updates live). Otherwise they write the file directly with the
revision check and atomic rename (§14.5). `--read-only` disables all write tools.

---

## 20. Claude Code skill

`skills/archguide/SKILL.md`. `archguide init` copies it to
`.claude/skills/archguide/SKILL.md` in the user's repo. Draft:

```markdown
---
name: archguide
description: Use the project's architecture model (architecture/*.archguide.json) when planning features, mapping the repo, or making structural changes in this React + Node.js + PostgreSQL codebase. Use before adding services, modules, routes, tables, queues or cross-package imports.
---

# ArchitectureGuide

The architecture model lives in `architecture/`. `architecture/ARCHITECTURE.md` is the readable version.

## Before you plan a feature
1. Read the architecture: MCP `get_architecture` (focus on the area you will change), or read `architecture/ARCHITECTURE.md`.
2. Follow every line under "Invariants". Do not "fix" items listed under "Known issues".
3. For a non-trivial feature, create a change set (`create_change_set`), model the change (`upsert_elements`, `upsert_relations`, `apply_template` with `changeSetId`), run `validate_project`, then `generate_tasks` and `export` with `plan-md`. Implement the tasks in order.

## After a structural change
- Update the model (MCP write tools), or run `npx archguide analyze --write` and review the result.
- Run `npx archguide check`. It must pass.

## When the repo has no model yet
Use the MCP prompt `map-repository`, or:
`npx archguide init && npx archguide analyze --write && npx archguide export agent-md --write`.

## Without MCP
Every MCP tool has a CLI equivalent: `npx archguide --help`.
```

---

## 21. CLI

Package `cli`, binary `archguide`. Global options: `--workspace <dir>`
(default `./architecture`), `--project <id>`, `--json` (machine output),
`--quiet`.

| Command | Purpose | Main options |
|---|---|---|
| `archguide init` | Create `architecture/` with config, an empty or template project, the skill, and `.gitignore` entries | `--template <code\|id>`, `--name`, `--no-skill` |
| `archguide serve` | Local server + web app + live sync | `--port 4317`, `--open`, `--host 127.0.0.1` |
| `archguide analyze [path]` | Run the analyzer | `--write` (apply suggested ops as inferred), `--min-confidence 0.6`, `--db`, `--include`, `--exclude` |
| `archguide validate` | Run model rules | `--change-set <id>`, `--fail-on error\|warning` |
| `archguide check` | CI gate: model rules + analysis rules + generated dependency-cruiser rules + drift | `--fail-on error`, `--format text\|json\|github` |
| `archguide drift` | Show model vs code differences | `--format` |
| `archguide export <format>` | Any export | `--change-set`, `--focus`, `--depth`, `--out`, `--write` (use config paths) |
| `archguide generate <target>` | Enforcement configs | `dependency-cruiser \| nx \| archunit`, `--out` |
| `archguide templates` | List templates | – |
| `archguide mcp` | Start the MCP server (same as `archguide-mcp`) | – |
| `archguide migrate` | Upgrade project files to the latest `schemaVersion` | `--dry-run` |

Exit codes: `0` OK, `1` findings at or above `--fail-on`, `2` usage or config
error, `3` internal error.

`--format github` prints GitHub Actions annotations
(`::error file=...,line=...::message`).

---

## 22. Enforcement and CI

### 22.1 Generators

```ts
interface EnforcementGenerator {
  id: 'dependency-cruiser' | 'nx' | 'archunit';
  generate(project: Project, ctx: { repoRoot: string; profile: StackProfile }): { path: string; content: string };
}
```

**Sources of rules:**
1. Template invariants that the profile can compile (they are stored with a
   machine form next to the sentence: `{ from: kind/glob, notTo: kind/glob/package[] }`).
2. Relations that are **absent**: for `depends-on`-style rules between elements
   with `codePaths` in strict packs (layered, hexagonal, fsd), any import that is
   not modeled is forbidden.
3. Profile defaults: no DB clients in React packages (RNP-003), no cycles
   (AP-003 / RNP-018), FSD direction (RNP-013), feature isolation (RNP-014).

### 22.2 Generated dependency-cruiser config (example)

```js
// Generated by archguide from architecture/shop.archguide.json (revision 42). Do not edit.
// Regenerate: npx archguide generate dependency-cruiser
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'AG-hexagonal-domain-no-infra',
      comment: 'dom.order MUST NOT depend on adapters or ORMs (template T3, svc.orders)',
      severity: 'error',
      from: { path: '^services/orders/src/domain' },
      to: { path: '^(services/orders/src/adapters|node_modules/(@prisma/client|drizzle-orm|express|fastify)/)' },
    },
    {
      name: 'AG-RNP-003-no-db-client-in-frontend',
      comment: 'Browser code MUST NOT import database clients (app.web)',
      severity: 'error',
      from: { path: '^apps/web/src' },
      to: { path: 'node_modules/(pg|postgres|@prisma/client|drizzle-orm|typeorm|knex|kysely)/' },
    },
    {
      name: 'AG-RNP-013-fsd-direction',
      severity: 'warn',
      from: { path: '^apps/web/src/(shared|entities)/' },
      to: { path: '^apps/web/src/(features|widgets|pages|app)/' },
    },
    { name: 'AG-no-circular', severity: 'warn', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
```

The generated file works **without** ArchitectureGuide installed in CI
(`npx depcruise apps services packages`).

### 22.3 `archguide check`

1. Load the project and run model rules (`--fail-on`, default `error`).
2. Run the analyzer (with cache).
3. Run analysis rules (RNP-001…004, 012, 013, 015, 017, 018).
4. Run dependency-cruiser with the generated rules (in memory, the file does not need
   to exist).
5. Compute drift. `missingInCode` items with `status: existing` → warning.
   `newInCode` deployables → info.
6. Print the report. Exit code from the highest severity vs `--fail-on`.

### 22.4 GitHub Action

```yaml
# .github/workflows/architecture.yml
name: architecture
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx -y archguide check --format github --fail-on error
```

Later: a published `archguide/check-action` that also posts a PR summary with
new findings and drift.

---

## 23. Security and privacy

- **Local only (R9).** The analyzer, rules, exports and rendering run on the
  user's machine. No telemetry in v1.
- **No code execution.** The analyzer never imports or runs repository files
  (`vite.config.ts`, `next.config.js`, …). It parses them statically with ts-morph.
- **Secrets.** `.env` values are never stored or exported (names only). The
  database URL is read from an env var at run time and never written.
- **Database.** Read-only transaction, catalog queries only, no table data.
- **Local server.** Binds `127.0.0.1` by default; a random token is required;
  CORS off; WebSocket origin check.
- **MCP.** stdio only; `--read-only` mode; file writes are restricted to the
  workspace folder and the configured export paths. Paths are normalized and
  checked to stay inside the repo root.
- **Markdown.** Rendered with `react-markdown` without raw HTML (`skipHtml`), so
  notes cannot inject scripts.
- **Imported files** are validated with Zod before use. Unknown fields are dropped.

---

## 24. Testing strategy

| Layer | Tool | What |
|---|---|---|
| core schema | Vitest + fast-check | Parse/serialize round-trip; deterministic output; JSON Schema matches Zod |
| core ops | Vitest + fast-check | `applyOps(applyOps(p, ops).inverse)` restores `p`; all-or-nothing on error |
| catalog | Vitest | Every concept has a shape, icon, prefix, docs; every relation type has at least one allow rule; hard constraint table (§10.4) as test cases |
| rules | Vitest | Each rule: ≥1 positive and ≥1 negative fixture graph; quick fixes remove the finding; perf test (500/1,000 < 100 ms) |
| templates | Vitest | Each template validates with 0 errors under its packs; IDs unique with any params; snapshot of ops |
| exporters | Vitest golden files | Each format for each template; Mermaid/LikeC4/Structurizr outputs parsed by their tools in CI (optional job) |
| changesets | Vitest | Diff correctness; task order for the "add payments" fixture |
| analyzer | Vitest + fixture repos | Expected facts and candidates per fixture; "bad" fixture triggers each analysis rule; no file outside the repo is read |
| server | Vitest | WebSocket protocol; revision conflicts; external file change |
| MCP | Vitest with the SDK client | Every tool: happy path + error path; envelope shape |
| CLI | Vitest (execa) | Exit codes; `--format github` |
| web | Playwright | Drag a shape, rename, connect (valid + refused), nest, apply template, quick fix, undo/redo, export, change set overlay |
| a11y | Playwright + axe | Panels and dialogs without violations |

**Fixture repos** (`packages/analyzer/fixtures/`):
1. `vite-express-prisma`: T1 shape.
2. `nest-modular-drizzle`: NestJS modular monolith, schema per module (T4).
3. `pnpm-bff-pgboss`: React + BFF + 2 services + pg-boss worker (T5 + T7).
4. `bad-practices`: one example of each analysis rule (RNP-001…004, 012, 013, 015, 017, 018).

**Smoke corpus (not committed):** public sample apps, for example React and
Node implementations of the RealWorld "Conduit" app, downloaded at a pinned
commit in a nightly job.

---

## 25. Delivery phases and task checklists

Estimates assume one full-time developer. They are rough.

### Phase 0: Foundations (~1 week)

- [x] pnpm workspace, Turborepo, `tsconfig.base.json` (strict, ESM), ESLint, Prettier
- [x] Vitest setup; GitHub Actions CI (lint, format, typecheck, test, depcruise, schema check)
- [x] `core/schema` with Zod; JSON Schema generation script → `schema/archguide.schema.json`
- [x] `core/serialize` (deterministic) + round-trip property tests; `core/migrate` skeleton
- [x] `core/ids` (slug, prefix, collision suffix)
- [x] `core/ops`: types, `validateOps`, `applyOps` with inverse; property tests
- [x] `core/catalog`: categories, shapes, generic concepts, core relation types, matrix, `validRelationTypes`, `checkRelation`, `checkNesting`
- [x] `profiles/react-node-postgres`: concepts, relations, nesting, deny rules
- [x] Profile registry (`createCatalog(profiles)`); package dependency rules (§4.2) checked with dependency-cruiser
- **Done when:** schema round-trips deterministically; the §10.4 table passes as tests. **Done.**

### Phase 1: Canvas MVP (~3 weeks)

- [ ] Vite + React app shell, routes, Tailwind, Radix, theme (light/dark)
- [ ] Shape registry: all shapes in §9.2 as SVG components; gallery page
- [ ] `ShapeNode`, `RelationEdge`, handles, badges
- [ ] Palette (search, Basic/Full, groups), drag and drop
- [ ] Inline label edit; Inspector with forms from `propertySchema`
- [ ] Connect with `isValidConnection`, target glow/fade, relation picker, refusal toast with fix
- [ ] Groups and nesting with `checkNesting`
- [ ] Color by layer + override, legend
- [ ] `projectStore`, `historyStore` (inverse ops), `uiStore`
- [ ] Undo/redo, copy/paste/duplicate, multi-select, align, snap, minimap
- [ ] Dexie persistence, autosave, workspace page (list/new/duplicate/delete)
- [ ] JSON import/export
- [ ] Command palette + shortcuts (§13.5)
- **Done when:** a user builds the T1 diagram from scratch in < 2 minutes (Playwright scenario), and a refused relation shows a message and a working fix.

### Phase 2: Rules engine (~2 weeks)

- [ ] `core/graph` (GraphQuery, Tarjan SCC, paths, sync depth, lifting)
- [ ] Rule API, packs, `replaces`, overrides, thresholds
- [ ] Model-scope rules: AP-001…AP-018, RNP-001, 002, 005–011, 014, 016
- [ ] Rules worker with incremental runs; findings store
- [ ] Problems panel, badges, halos, edge overlays, tooltips
- [ ] Quick fixes with preview; suppressions with reason
- [ ] `docs/RULES.md` generated from rule metadata
- **Done when:** every rule has positive and negative fixture tests and a docs entry; perf budget met.

### Phase 3: Templates and projects (~2 weeks)

- [ ] Template engine (params dialog, new project from template, stamp into canvas, `derivedFrom`, packs on)
- [ ] T1, T2, T3, T4, T5, T6, T7, T11
- [ ] Save selection as custom template; import/export template files
- [ ] Snapshots (create, list, restore), compare (diff overlay)
- [ ] File System Access "Open folder" mode; `archguide.config.json` reading
- [ ] ELK auto-layout worker
- **Done when:** each template validates with 0 errors under its own packs; a project saved to a folder reopens identically.

### Phase 4: Notes, annotations, exports (~2 weeks)

- [ ] Element/relation notes; sticky notes, callouts, regions, comments
- [ ] Project notes with `@id` mentions; glossary note
- [ ] Decisions (ADRs) panel and badges
- [ ] Exporters: `agent-md`, `agent-yaml`, `agents-snippet`, `mermaid`, `dbml`, `png`/`svg`, `json`
- [ ] Focus/depth neighborhood export
- [ ] Export dialog with preview and copy
- [ ] Golden-file tests for each exporter × template
- **Done when:** the agent-md output of each template is reviewed and stable.

### Phase 5: Server, CLI, MCP, skill (~2 weeks)

- [ ] `server`: Fastify, static app, token, WebSocket protocol, chokidar, lock file, atomic writes, revision checks
- [ ] Web `serveClient` (live updates, conflict UI)
- [ ] CLI: `init`, `serve`, `validate`, `export`, `generate`, `templates`, `migrate`, `mcp`
- [ ] MCP server: envelope, all tools except analysis ones, resources, prompts `plan-feature`
- [ ] Skill file + `init` copy
- [ ] MCP contract tests
- **Done when:** Claude Code creates, edits, validates and exports a project only through MCP, and the open browser tab updates live.

### Phase 6: Repository analysis and enforcement (~4 weeks)

- [ ] Analyzer pipeline (discover, engines, detectors, resolve, match, cache, limits)
- [ ] Detectors in §18.4 (workspace, React, Node, Postgres, infra)
- [ ] Data ownership algorithm (§18.5)
- [ ] Analysis-scope rules RNP-003, 004, 012, 013, 015, 017, 018 (+ analysis parts of 001, 002, 005, 006)
- [ ] Optional live introspection (§18.7)
- [ ] Generators: dependency-cruiser (default), Nx, ArchUnitTS
- [ ] CLI: `analyze`, `check`, `drift`; `--format github`
- [ ] MCP: `analyze_repository`, `apply_analysis`, `diff_with_repository`, `generate_enforcement`; prompts `map-repository`, `review-change`
- [ ] UI: Analysis review panel; database view with ownership colors; evidence links
- [ ] GitHub Action example; fixture repos 1–4
- **Done when:** on fixtures 1–3 the baseline has ≥ 80% of the hand-made reference elements and no element without evidence; fixture 4 triggers every analysis rule; `archguide check` fails on a seeded domain → Prisma import with file and line.

### Phase 7: Change sets and advanced views (~3 weeks)

- [ ] Change-set mode (record ops into a change set), overlay, new-findings filter
- [ ] Rebase on baseline changes; conflict list
- [ ] Task generation (§16.4) + tasks panel
- [ ] Exporters: `plan-md`, `speckit`, `kiro`, `likec4`, `structurizr`, `plantuml`
- [ ] MCP: change-set tools; `plan-feature` end to end
- [ ] Views: context/container/component/database/scenario; drill-down; breadcrumbs
- [ ] Scenario recording, playback, Mermaid sequence export
- [ ] Focus mode and filters
- [ ] Templates T8, T9, T10, T12, T13
- **Done when:** end-to-end flow works: baseline from repo scan → change set in the UI → plan export → agent implements → `archguide check` passes.

### Later (after v1)

- v1.1 profiles: **Next.js / React Server Components**; **Supabase / PostgREST**
  (with an RLS rule).
- OpenTelemetry trace import (R10): confirm `calls` edges and volumes.
- Scaffolding from a change set (folders, ports, empty stubs as a patch) (R12).
- Optional in-app AI assistant ("what is missing?", "explain this finding",
  "draft a model from text"), off by default, needs an API key.
- Complexity score per project and per change set.
- Presentation mode.
- Real-time collaboration (Yjs over the same ops).
- More profiles: Python, Go, Java; Redis, Kafka, S3 concepts.

**Total v1 estimate:** about 19 weeks for one developer, about 11 weeks for
two (core/web and analyzer/MCP can run in parallel after Phase 2).

---

## 26. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Rules too strict; users fight the tool | Only meaningless relations are hard errors; all else is a warning with suppression; packs follow the chosen pattern |
| Palette overwhelms beginners | Basic/Full modes; search by tech name; templates as the main entry point |
| Analyzer guesses wrong | Evidence and confidence on every item; nothing is `reviewed` until a human accepts; rejected items are remembered |
| Agent export too large | `focus` + `depth`; YAML tuple form; change-set-only export |
| File System Access API is Chromium-only | Download/upload fallback; serve mode works in all browsers |
| Schema changes break files | `schemaVersion` + migration fixtures from day one |
| Concurrent writes (UI, MCP, CLI, git) | Single writer in serve mode; revision checks + atomic writes otherwise; reload on external change |
| Framework detection breaks with new library versions | Small detectors with fixtures; confidence < 1 for pattern matches; easy to add detectors |
| Generated CI rules create noise | Generated rules only from strict packs and explicit invariants; `severity` follows the rule; `--fail-on error` default |
| Same niche as Eraser / IcePanel / Archaic | Focus on stack-specific rules + enforcement + change-set planning (R11) |

---

## 27. Open decisions

| # | Question | Recommendation |
|---|---|---|
| 1 | Web only, or also desktop (Tauri)? | Web + `archguide serve` first; Tauri only if file access becomes a pain |
| 2 | Hosted sync / collaboration? | Not in v1. Git is the sync layer. Ops are ready for Yjs later |
| 3 | License and distribution | npm packages (`archguide`, `archguide-mcp`); public static web build. License to choose (MIT or Apache-2.0 fits the goal) |
| 4 | ~~Languages for the analyzer~~ | **Decided:** React + Node.js + PostgreSQL, JS/TS only |
| 5 | Next.js in v1? | v1.1 profile, right after v1 (needs its own rules for server components) |
| 6 | Supabase / PostgREST? | v1.1, with an RLS rule |
| 7 | Product name and domain | "ArchitectureGuide" / `archguide` CLI as a working name |

---

## 28. Glossary

| Term | Meaning |
|---|---|
| Concept | A type of element in the catalog (`node.service`). Has a shape, icon, rules for nesting |
| Element | An instance of a concept in a model (`svc.orders`) |
| Relation | A typed, directed edge between two elements |
| Model | All elements and relations of a project |
| View | A layout of a subset of the model |
| Profile | A plug-in with stack-specific concepts, rules, templates, detectors, generators |
| Rule pack | A named group of rules switched on together |
| Finding | A result of a rule: severity, message, targets, evidence |
| Suppression | An accepted finding, with a reason |
| Template | A parameterized model fragment for a pattern |
| Invariant | A MUST / MUST NOT sentence exported to agents and compiled into CI rules |
| Op | One atomic change to a project |
| Change set | A named list of ops on top of the baseline: a feature proposal |
| Baseline | The current architecture (model without change sets) |
| Fact | One observation of the analyzer, with evidence |
| Drift | A difference between the model and the code |
| Lifting | Treating a child's relation as its ancestor's relation for higher-level rules |

---

## 29. Sources

Research date: 2026-10-27. Vendor claims are marked as such in §3.

- Structurizr: [AI](https://docs.structurizr.com/ai), [MCP server](https://docs.structurizr.com/ai/mcp)
- LikeC4: [docs](https://likec4-docs-astro.pages.dev/), [MCP](https://likec4-docs-astro.pages.dev/tooling/mcp), [GitHub](https://github.com/likec4/likec4)
- Ilograph: [example](https://gtrunsec.github.io/Diagrams-as-Code/posts/ilograph), [MCP](https://mcp.so/server/ilograph-mcp-server/QuincyMillerDev)
- IcePanel: [vs Structurizr](https://icepanel.io/blog/2025-11-14-icepanel-vs-structurizr), [tools overview 2026](https://icepanel.io/blog/best-collaborative-software-architecture-diagramming-tools-2026)
- Cloudcraft: [site](https://cloudcraft.co/), [Datadog](https://datadoghq.com/ja/product/cloudcraft)
- Excalidraw MCP: [mcp_excalidraw](https://mcpservers.org/servers/yctimlin/mcp_excalidraw), [excalidraw-mcp-server](https://awesome.ecosyste.ms/projects/github.com%2Ffromsko%2Fexcalidraw-mcp-server)
- GitDiagram: [GitHub](https://github.com/martin226/gitdiagram), [AlternativeTo](https://alternativeto.net/software/gitdiagram/about)
- Eraser: [codebase diagrams](https://docs.eraser.io/docs/codebase-diagrams), [agent integrations](https://docs.eraser.io/docs/using-ai-agent-integrations)
- Archaic: [MCP](https://glama.ai/mcp/servers/archaic-ai/archaic-mcp)
- repo-cartographer: [listing](https://enterprisedna.co/directories/mcp/builditwithgk-repo-cartographer)
- Other MCP diagram servers: [mermaid-mcp-server](https://enterprisedna.co/directories/mcp/gittyburstein-mermaid-mcp-server), [Blueprint MCP](https://www.scriptbyai.com/blueprint-mcp), [DiagramMCP](https://glama.ai/mcp/servers/@LelonDelonMelon/diagramMCP/tree/a2f22b54361bfe09b5adf5e01885e2b4885dbd78)
- CodeSee: [loot-drop](https://www.loot-drop.io/startup/2500-codesee), [CB Insights](https://www.cbinsights.com/compare/codesee-vs-github)
- dependency-cruiser: [GitHub](https://github.com/sverweij/dependency-cruiser), [README](https://cdn.jsdelivr.net/npm/dependency-cruiser@17.3.10/README.md)
- ArchUnitTS: [GitHub](https://github.com/LukasNiessen/ArchUnitTS)
- Nx: [enforce module boundaries](https://nx.dev/docs/features/enforce-module-boundaries.md)
- Kiro / Spec Kit: [Martin Fowler](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html), [comparison](https://glukhov.org/ai-devtools/ai-coding-assistants/spec-kit-vs-kiro-vs-claude-code/), [guide](https://medium.com/@visrow/comprehensive-guide-to-spec-driven-development-kiro-github-spec-kit-and-bmad-method-5d28ff61b9b1)
- Multiplayer: [auto-documentation](https://scriptagc.wasmer.app/https_www_multiplayer_app/docs/features/system-auto-documentation), [press release](https://www.businesswire.com/news/home/20240625383448/en)
- Amplication: [GitHub](https://github.com/rfarrey/amplication), [deep dive](https://blog.brightcoding.dev/2025/09/05/automating-backend-code-and-apis-with-live-templates-and-plugins-a-deep-dive-into-amplication)
- ChartDB: [LogRocket](https://blog.logrocket.com/mastering-charts-database-visualization-chartdb/), [SourceForge](https://sourceforge.net/mirror/chartdb/profile)
- pg-introspection: [npm](https://npmjs.com/package/pg-introspection); read-only role issue: [AgamiAI](https://github.com/AgamiAI/agami-core/issues/175)
- arkit: [GitHub](https://github.com/dyatko/arkit)
