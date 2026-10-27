# ArchitectureGuide

A drag-and-drop builder for frontend and backend architecture.

- Place geometric shapes. Each shape is an architectural concept (service, data store, queue, port, page ...).
- Connect shapes with typed relations. The tool blocks relations that make no sense and flags known anti-patterns.
- Start from built-in patterns (Hexagonal, CQRS, Microservices, BFF, Micro-frontends ...).
- Add notes, annotations and decisions. Save projects locally or into your repository.
- Export the architecture in an AI-agent-friendly format to plan features.
- Analyze an existing repository through an MCP server and a CLI, and keep the model in sync with the code.

v1 targets **React + Node.js + PostgreSQL** (TypeScript / JavaScript).

Status: planning.

- [docs/PLAN.md](docs/PLAN.md): the full implementation plan
- [docs/STACK-REACT-NODE-POSTGRES.md](docs/STACK-REACT-NODE-POSTGRES.md): v1 stack profile (concepts, rules, templates, analyzer)
- [docs/RESEARCH.md](docs/RESEARCH.md): similar projects and what we take from them
