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

Phases 0 (foundations) and 1 (canvas) are done. Run `pnpm install && pnpm dev` and open
http://localhost:5179: create a project or open the starter, drag shapes from the palette,
connect them, and open the **Learn** tab.

| Package                                                                          | Content                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/web`](apps/web)                                                           | The builder: React Flow canvas, palette, inspector with generated property forms, Learn tab with three levels, refusals with fixes and explanations, undo/redo, copy/paste, command palette, autosave in the browser, JSON import/export                   |
| [`packages/core`](packages/core)                                                 | Zod schema of the project file, deterministic serialization, migrations, readable IDs, the concept catalog (shapes, categories, relation rules and properties), the op engine with undo, and the learning module (content schemas, parsers, lesson checks) |
| [`packages/profiles/react-node-postgres`](packages/profiles/react-node-postgres) | React, Node.js and PostgreSQL concepts, profile relation types, the hard constraints, and learning content: [texts](packages/profiles/react-node-postgres/content/docs) and [lessons](packages/profiles/react-node-postgres/content/lessons)               |
| [`schema/archguide.schema.json`](schema/archguide.schema.json)                   | JSON Schema of the project file, generated from the Zod schema                                                                                                                                                                                             |

Next: Phase 2, the rules engine (anti-pattern findings on the canvas).

## Development

Requirements: Node.js 22.12 or later, pnpm 10.

```bash
pnpm install
pnpm dev           # the builder at http://localhost:5179
pnpm test          # Vitest (unit, property and content tests)
pnpm e2e           # Playwright scenarios against the builder
pnpm typecheck     # tsc in every package (Turborepo)
pnpm lint          # ESLint
pnpm format        # Prettier
pnpm depcruise     # package boundaries (Implementation.md §4.2)
pnpm schema        # regenerate schema/archguide.schema.json
pnpm content       # compile learning texts and lessons after editing content/
pnpm build         # production build of the builder
pnpm check         # everything CI runs (except e2e)
```

## Writing learning content

- Texts: `packages/profiles/react-node-postgres/content/docs/<id>.md` (format: Implementation.md §17.4).
- Lessons: `packages/profiles/react-node-postgres/content/lessons/<name>.yaml` (format: Implementation.md §17.5).
- Run `pnpm content`, then `pnpm test`. The tests prove that every lesson can be finished step by step.
