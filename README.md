# ArchitectureGuide

A drag-and-drop builder for frontend and backend architecture, for beginners and seniors.
Use it to **learn** high-level concepts (models, API design, database schemas, stored
procedures, state management, authentication, concurrency, parallelism ...), to **plan**
features, and to **onboard** people and AI agents to a project or a concept.

- Place geometric shapes. Each shape is an architectural concept (service, data store, queue, port, page ...).
- Connect shapes with typed relations. The tool blocks relations that make no sense and flags known anti-patterns.
- Start from built-in patterns (Hexagonal, BFF, modular monolith, outbox ...).
- Add notes, annotations and decisions. Save projects locally or into your repository.
- Export the architecture in an AI-agent-friendly format to plan features.
- Analyze an existing repository through an MCP server and a CLI, and keep the model in sync with the code.
- Learn with texts at three levels and interactive lessons on the real canvas that check your work.
- Onboard people and agents with project tours and an onboarding pack that explains exactly the concepts the project uses.

v1 targets **React + Node.js + PostgreSQL** (TypeScript / JavaScript).

See [Implementation.md](Implementation.md) for the full design and the delivery plan.

## Status

Phases 0 to 9 are done: foundations, canvas, rules engine, templates and projects, notes and
exports, responsive editor, learning mode, the server, CLI and MCP server, repository
analysis with enforcement, and change sets with advanced views. Run `pnpm install && pnpm dev` and open http://localhost:5179:
create a project or open the starter, drag shapes from the palette, connect them, and open
the **Learn** tab. The **Problems** panel lists anti-patterns in the design, with quick fixes
and a "Why?" explanation for each. All rules: [docs/RULES.md](docs/RULES.md).

Start from one of thirteen architecture templates (starter, layered, hexagonal, modular
monolith, backend-for-frontend, database per service, background jobs, transactional outbox,
CQRS-lite, realtime, Feature-Sliced Design, type-safe monorepo, multi-tenant SaaS), each with a
tour and a learning text. Save snapshots and compare the canvas
with them, tidy the layout automatically, and keep projects as files in your repository
with **Open folder** (Chromium browsers).

Annotate the canvas (sticky notes, regions, callouts, comment threads), keep project
notes with `@` mentions, a glossary and decision records, and play or write guided
tours. **Export** (Ctrl+E) writes `ARCHITECTURE.md` for AI agents, an `AGENTS.md`
snippet, YAML, an onboarding pack for new team members, concept packs, Mermaid, DBML,
LikeC4, Structurizr DSL, C4-PlantUML, an OpenAPI skeleton, sequence diagrams, JSON, PNG and SVG. Examples for every template: [golden files](packages/profiles/react-node-postgres/golden).

| Package                                                                          | Content                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/web`](apps/web)                                                           | The builder: React Flow canvas, palette, inspector with generated property forms, Learn tab with three levels, refusals with fixes and explanations, Problems panel with finding badges, quick fixes and suppressions, templates, snapshots with compare, automatic layout and align, undo/redo, copy/paste, command palette, autosave in the browser or to a folder, JSON import/export                                                             |
| [`packages/core`](packages/core)                                                 | Zod schema of the project file, deterministic serialization, migrations, readable IDs, the concept catalog (shapes, categories, relation rules and properties, concept guides), the op engine with undo, graph queries and the rules engine with 18 generic anti-pattern rules, the template engine, project diff, and the learning module (content schemas, parsers, lesson checks)                                                                 |
| [`packages/profiles/react-node-postgres`](packages/profiles/react-node-postgres) | React, Node.js and PostgreSQL concepts, profile relation types, the hard constraints, 25 stack rules (ownership, concurrency, API design, authentication, state management, CQRS), thirteen architecture templates, concept guides (real-world uses and typical connections for every shape), and learning content: [texts](packages/profiles/react-node-postgres/content/docs) and [lessons](packages/profiles/react-node-postgres/content/lessons) |
| [`packages/analyzer`](packages/analyzer)                                         | The repository analyzer: discover, engines (TypeScript index, Prisma, SQL, compose, env), detectors, resolve and match, cache, live Postgres introspection, `archguide check`; [fixture repositories](packages/analyzer/fixtures)                                                                                                                                                                                                                    |
| [`packages/workspace`](packages/workspace)                                       | File IO shared by the server, the CLI and MCP: atomic writes, file locks, revision checks, the serve lock file, export writing                                                                                                                                                                                                                                                                                                                       |
| [`packages/server`](packages/server)                                             | `archguide serve`: the web app, the HTTP API and the WebSocket protocol, the single writer of the files while it runs, file watching                                                                                                                                                                                                                                                                                                                 |
| [`packages/mcp-server`](packages/mcp-server)                                     | `archguide-mcp`: tools, resources and prompts for AI agents (stdio)                                                                                                                                                                                                                                                                                                                                                                                  |
| [`packages/cli`](packages/cli)                                                   | `archguide`: init, serve, validate, export, templates, explain, onboarding, migrate, mcp                                                                                                                                                                                                                                                                                                                                                             |
| [`skills/archguide`](skills/archguide)                                           | The Claude Code skill that `archguide init` copies into a repository                                                                                                                                                                                                                                                                                                                                                                                 |
| [`schema/archguide.schema.json`](schema/archguide.schema.json)                   | JSON Schema of the project file, generated from the Zod schema                                                                                                                                                                                                                                                                                                                                                                                       |

Pick a shape and the builder explains it: what it is for, where it is used in real
projects, and what it connects to (for example: actions update a Redux store, an effect
dispatches a thunk, the thunk calls the API client). A "+" next to each typical
connection adds the other shape and draws the arrow (Implementation.md §13.11).

The editor also works on tablets and phones: drawers on tablets, and on phones a full-screen
canvas with a bottom toolbar, bottom sheets, tap-to-connect, a long-press menu and
"select several" (Implementation.md §13.10).

**Learn** (`#/learn`): 24 lessons in six tracks run on the real canvas. Each step is
checked as you build, with hints and "Show me". Exercises start from a flawed design and
pass when the rules are happy. The **Library** (`#/library`) has a text for every shape and
arrow at beginner, intermediate and senior level, with quizzes. The **Concurrency lab**
(`#/lab`) replays a lost update, and its fixes, step by step. Progress stays in the browser
and can be exported.

**Work with your repository and AI agents** (Phase 7):

```bash
npx archguide init --template T1   # architecture/ with config, a project, ARCHITECTURE.md and the Claude Code skill
npx archguide serve                # the editor on these files; opens at http://127.0.0.1:4317/?t=…
claude mcp add archguide -- npx archguide-mcp --workspace ./architecture
```

The packages are not on npm yet: in this repository, use `pnpm archguide …` instead of
`npx archguide …`, and `node packages/cli/dist/archguide-mcp.js` after `pnpm build`.

While `archguide serve` runs, every change an agent makes through MCP (or the CLI) shows up
live in the open browser tab, and changes in the browser are saved to the files. When a file
changes outside the app while you have unsaved changes, the editor asks: reapply or discard.
The MCP server has 35 tools (read and edit the model, change sets, templates, rules and quick fixes,
exports, learning texts, lessons, onboarding and tours), resources and the `plan-feature`
prompt; every write returns only the findings it introduced. The CLI also validates
(`archguide validate --fail-on warning`), exports, explains concepts in the terminal and
writes the onboarding pack (`archguide --help`).

**Read an existing repository and keep it in line with the model** (Phase 8):

```bash
npx archguide analyze           # draft the model from the code, with evidence (no code is run)
npx archguide analyze --write   # add the suggestions to the project, as inferred
npx archguide check --format github --fail-on error   # CI gate: rules, code findings, generated dependency rules, drift
npx archguide generate dependency-cruiser             # also nx, archunit
```

The analyzer finds deployables, routes, handlers, NestJS modules, state, API clients, schemas
and tables (Prisma, Drizzle, TypeORM, SQL migrations), job queues, service calls and who owns
which data, and reports code problems with file and line: database clients in the browser,
secrets in `VITE_*` variables, shared tables, several migration owners, foreign keys without an
index, import cycles between modules and more ([docs/RULES.md](docs/RULES.md#analysis-rules)).
`--db` also reads a live database catalog, read-only. In the editor, the **Analysis** dialog
lists the suggestions with their evidence (accept, edit or reject), and **Views → Create
database view** colors the data by the service that owns it. MCP agents get
`analyze_repository`, `apply_analysis`, `diff_with_repository`, `generate_enforcement` and the
`map-repository` and `review-change` prompts. CI: [docs/examples/architecture.yml](docs/examples/architecture.yml).

**Plan features as change sets** (Phase 9): **Change sets → Start change set** puts the
editor in change-set mode. Your edits go into the change set, not the model; the canvas shows
what it adds (green), changes (amber) and removes (red, dashed), and the Problems panel the
findings it introduces. Generate the tasks in build order (data first, frontend last), tick and
reorder them, export the plan (`plans/<id>.md`, Spec Kit or Kiro), and **Apply to baseline**
once it is built. When the model changes under a change set, its conflicts are listed. Agents
do the same through MCP (`create_change_set`, `changeSetId` on every write, `generate_tasks`,
`export` with `plan-md`; the `plan-feature` prompt walks through it); the CLI has
`validate --change-set` and `export plan-md --change-set`.

The **Views** menu creates context, container, component, database and scenario views.
Double-click a service or a database to open what is inside (breadcrumbs lead back). Record a
scenario by clicking arrows in order, play it back, and export it as a sequence diagram. The
**API view** lists the endpoints with their data shapes and exports an OpenAPI skeleton. Press
**F** to focus on the selection, and **Filter** by tag, layer, status or owner.

## Development

Requirements: Node.js 22.12 or later, pnpm 10.

```bash
pnpm install
pnpm dev           # the builder at http://localhost:5179
pnpm archguide     # the CLI from the sources, e.g. pnpm archguide serve --workspace ../my-repo/architecture
pnpm test          # Vitest (unit, property and content tests)
pnpm e2e           # Playwright scenarios: desktop, phone and tablet projects
pnpm typecheck     # tsc in every package (Turborepo)
pnpm lint          # ESLint
pnpm format        # Prettier
pnpm depcruise     # package boundaries (Implementation.md §4.2)
pnpm schema        # regenerate schema/archguide.schema.json
pnpm content       # compile learning texts and lessons after editing content/
pnpm rules-doc     # regenerate docs/RULES.md after changing a rule
pnpm build         # production build of the builder and the bundled CLI (packages/cli/dist)
pnpm check         # everything CI runs (except e2e)
```

## Writing learning content

- Texts: `packages/profiles/react-node-postgres/content/docs/<id>.md` (format: Implementation.md §17.4).
- Lessons: `packages/profiles/react-node-postgres/content/lessons/<name>.yaml` (format: Implementation.md §17.5).
- Run `pnpm content`, then `pnpm test`. The tests prove that every lesson can be finished step by step.
