# ArchitectureGuide

A drag-and-drop builder for frontend and backend architecture.

- Place geometric shapes. Each shape is an architectural concept (service, data store, queue, port, page ...).
- Connect shapes with typed relations. The tool blocks relations that make no sense and flags known anti-patterns.
- Start from built-in patterns (Hexagonal, BFF, modular monolith, outbox ...).
- Add notes, annotations and decisions. Save projects locally or into your repository.
- Export the architecture in an AI-agent-friendly format to plan features.
- Analyze an existing repository through an MCP server and a CLI, and keep the model in sync with the code.

v1 targets **React + Node.js + PostgreSQL** (TypeScript / JavaScript).

See [Implementation.md](Implementation.md) for the full design and the delivery plan.

## Status

Phase 0 (foundations) is done:

| Package                                                                          | Content                                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`packages/core`](packages/core)                                                 | Zod schema of the project file, deterministic serialization, migrations, readable IDs, the concept catalog (shapes, categories, relation rules), and the op engine with undo (inverse ops) |
| [`packages/profiles/react-node-postgres`](packages/profiles/react-node-postgres) | React, Node.js and PostgreSQL concepts, profile relation types, and the hard constraints                                                                                                   |
| [`schema/archguide.schema.json`](schema/archguide.schema.json)                   | JSON Schema of the project file, generated from the Zod schema                                                                                                                             |

Next: Phase 1, the canvas MVP (`apps/web`).

## Development

Requirements: Node.js 22.12 or later, pnpm 10.

```bash
pnpm install
pnpm test          # Vitest (unit + property tests)
pnpm typecheck     # tsc in every package (Turborepo)
pnpm lint          # ESLint
pnpm format        # Prettier
pnpm depcruise     # package boundaries (Implementation.md §4.2)
pnpm schema        # regenerate schema/archguide.schema.json
pnpm check         # everything CI runs
```
