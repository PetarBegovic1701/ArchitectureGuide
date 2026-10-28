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

Phases 0 (foundations), 1 (canvas), 2 (rules engine), 3 (templates and projects) and
4 (notes, annotations, exports) are done. Run
`pnpm install && pnpm dev` and open http://localhost:5179: create a project or open the
starter, drag shapes from the palette, connect them, and open the **Learn** tab. The
**Problems** panel lists anti-patterns in the design, with quick fixes and a "Why?"
explanation for each. All rules: [docs/RULES.md](docs/RULES.md).

Start from one of eight architecture templates (starter, layered, hexagonal, modular
monolith, backend-for-frontend, database per service, background jobs, Feature-Sliced
Design), each with a tour and a learning text. Save snapshots and compare the canvas
with them, tidy the layout automatically, and keep projects as files in your repository
with **Open folder** (Chromium browsers).

Annotate the canvas (sticky notes, regions, callouts, comment threads), keep project
notes with `@` mentions, a glossary and decision records, and play or write guided
tours. **Export** (Ctrl+E) writes `ARCHITECTURE.md` for AI agents, an `AGENTS.md`
snippet, YAML, an onboarding pack for new team members, concept packs, Mermaid, DBML,
JSON, PNG and SVG. Examples for every template: [golden files](packages/profiles/react-node-postgres/golden).

| Package                                                                          | Content                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/web`](apps/web)                                                           | The builder: React Flow canvas, palette, inspector with generated property forms, Learn tab with three levels, refusals with fixes and explanations, Problems panel with finding badges, quick fixes and suppressions, templates, snapshots with compare, automatic layout and align, undo/redo, copy/paste, command palette, autosave in the browser or to a folder, JSON import/export |
| [`packages/core`](packages/core)                                                 | Zod schema of the project file, deterministic serialization, migrations, readable IDs, the concept catalog (shapes, categories, relation rules and properties), the op engine with undo, graph queries and the rules engine with 18 generic anti-pattern rules, the template engine, project diff, and the learning module (content schemas, parsers, lesson checks)                     |
| [`packages/profiles/react-node-postgres`](packages/profiles/react-node-postgres) | React, Node.js and PostgreSQL concepts, profile relation types, the hard constraints, 23 stack rules (ownership, concurrency, API design, authentication), eight architecture templates, and learning content: [texts](packages/profiles/react-node-postgres/content/docs) and [lessons](packages/profiles/react-node-postgres/content/lessons)                                          |
| [`schema/archguide.schema.json`](schema/archguide.schema.json)                   | JSON Schema of the project file, generated from the Zod schema                                                                                                                                                                                                                                                                                                                           |

The editor also works on tablets and phones: drawers on tablets, and on phones a full-screen
canvas with a bottom toolbar, bottom sheets, tap-to-connect, a long-press menu and
"select several" (Implementation.md §13.10).

Next: Phase 6, learning mode (Implementation.md §17).

## Development

Requirements: Node.js 22.12 or later, pnpm 10.

```bash
pnpm install
pnpm dev           # the builder at http://localhost:5179
pnpm test          # Vitest (unit, property and content tests)
pnpm e2e           # Playwright scenarios: desktop, phone and tablet projects
pnpm typecheck     # tsc in every package (Turborepo)
pnpm lint          # ESLint
pnpm format        # Prettier
pnpm depcruise     # package boundaries (Implementation.md §4.2)
pnpm schema        # regenerate schema/archguide.schema.json
pnpm content       # compile learning texts and lessons after editing content/
pnpm rules-doc     # regenerate docs/RULES.md after changing a rule
pnpm build         # production build of the builder
pnpm check         # everything CI runs (except e2e)
```

## Writing learning content

- Texts: `packages/profiles/react-node-postgres/content/docs/<id>.md` (format: Implementation.md §17.4).
- Lessons: `packages/profiles/react-node-postgres/content/lessons/<name>.yaml` (format: Implementation.md §17.5).
- Run `pnpm content`, then `pnpm test`. The tests prove that every lesson can be finished step by step.
