# Stack profile v1: React + Node.js + PostgreSQL

v1 supports one stack in depth instead of many stacks on the surface. A
**stack profile** is a plug-in package (`packages/profiles/react-node-postgres`)
that adds these parts to the generic core:

1. concepts (shapes) for the stack,
2. extra relation types and compatibility rules,
3. stack-specific anti-pattern rules,
4. templates,
5. analyzer detectors,
6. enforcement generators (dependency-cruiser config).

Other stacks (Next.js, Python, Go, Redis, Kafka ...) become more profiles
later. The core does not change for them.

**In scope:** React SPA (Vite), Node.js services (Express, Fastify, NestJS),
PostgreSQL (through Prisma, Drizzle, TypeORM, Kysely, Knex or `pg`), TypeScript
or JavaScript, npm / pnpm / yarn workspaces.

**Out of scope for v1, shown as a generic element:** Redis, Kafka, S3, other
databases. You can place them as "Other data store" or "External system".
Generic rules apply to them, and they get a small "outside profile" badge.

**Later (v1.1+):** Next.js / React Server Components, Supabase / PostgREST,
Hono, Bun/Deno runtimes.

---

## 1. Concepts

IDs use the prefixes `react.`, `node.`, `pg.`. Generic concepts (actor,
external system, auth provider, gateway, groups) come from the core.

### 1.1 React (frontend)

| ID | Name | Shape | Key properties |
|---|---|---|---|
| `react.app` | React app | Rectangle (React icon) | bundler (`vite`), router (`react-router` / `tanstack-router`), rendering (`csr`) |
| `react.route` | Route / Page | Window | path (`/orders/:id`), lazy (bool), auth required (bool) |
| `react.layout` | Layout route | Window (double frame) | path |
| `react.feature` | Feature module | Rounded rectangle | folder (`src/features/cart`), FSD layer |
| `react.component` | Shared component | Rounded rectangle (small) | folder |
| `react.design-system` | UI kit / design system | Rounded rectangle (stacked) | package name |
| `react.hook` | Custom hook | Rounded rectangle (hook icon) | – |
| `react.server-state` | Server-state cache | Dashed small cylinder | lib (`tanstack-query`, `swr`, `rtk-query`, `apollo`) |
| `react.client-store` | Client state store | Small cylinder | lib (`zustand`, `redux-toolkit`, `context`, `jotai`) |
| `react.api-client` | API client | Adapter (plug) | kind (`fetch`, `axios`, `openapi-generated`, `trpc`, `graphql`) |

### 1.2 Node.js (backend)

| ID | Name | Shape | Key properties |
|---|---|---|---|
| `node.service` | Node service | Rectangle (Node icon) | framework (`express` / `fastify` / `nestjs`), runtime version, transport (`rest` / `graphql` / `trpc` / `websocket`), scaling |
| `node.bff` | Backend-for-Frontend | Rectangle (BFF icon) | same as service, plus "serves" client |
| `node.worker` | Background worker | Rectangle (cog) | job lib (`pg-boss` / `graphile-worker`), concurrency |
| `node.scheduler` | Scheduled job | Rectangle (clock) | lib (`pg-boss` schedule / `node-cron` / `pg_cron`), cron |
| `node.ws-gateway` | Realtime gateway | Diamond | lib (`socket.io` / `ws`) |
| `node.module` | Module | Rounded rectangle | NestJS module or feature folder; public API (exports) |
| `node.route-handler` | Controller / route handler | Rounded rectangle | routes (`GET /orders`), validation (`zod` / `joi` / `class-validator`) |
| `node.middleware` | Middleware | Rounded rectangle (filter icon) | kind (`auth`, `validation`, `rate-limit`, `error`) |
| `node.use-case` | Use case / application service | Rounded rectangle | – |
| `node.domain` | Domain model / aggregate | Hexagon | invariants (list) |
| `node.port` | Port (interface) | Circle | – |
| `node.repository` | Repository / data access | Adapter (plug) | data access (`prisma` / `drizzle` / `typeorm` / `kysely` / `knex` / `pg`) |
| `node.event` | Domain / integration event | Triangle | payload schema |
| `node.contract` | API contract package | Circle (document) | kind (`openapi`, `zod`, `trpc-router`, `graphql-schema`) |
| `node.shared-lib` | Shared package | Rounded rectangle (stacked) | package name |

The ORM is a **property** (`dataAccess`) on repositories and services, not its
own shape. This keeps the canvas small.

### 1.3 PostgreSQL

| ID | Name | Shape | Key properties |
|---|---|---|---|
| `pg.cluster` | Postgres server | Dashed container (elephant icon) | version, hosting (`self`, `rds`, `neon`, `supabase` ...) |
| `pg.database` | Database | Cylinder | extensions (`pgvector`, `postgis`, `pg_cron` ...) |
| `pg.schema` | Schema | Cylinder segment (group inside database) | `ownedBy` (element ID), migration tool (`prisma-migrate` / `drizzle-kit` / `node-pg-migrate` / `typeorm` / `sql`), RLS enabled |
| `pg.table` | Table | Small rectangle (drill-down view only) | columns (from schema / introspection), FKs |
| `pg.view` | View / materialized view | Dashed cylinder | materialized (bool), refresh strategy |
| `pg.replica` | Read replica | Cylinder (copy icon) | lag tolerance |
| `pg.pooler` | Connection pooler | Small diamond | kind (`pgbouncer`, `pgcat`, `rds-proxy`, `app-pool`), mode (`transaction` / `session`) |
| `pg.job-queue` | Postgres job queue | Horizontal cylinder | lib (`pg-boss` / `graphile-worker`), queue names |
| `pg.channel` | LISTEN/NOTIFY channel | Thin horizontal cylinder | channel name |

Nesting rules: `pg.table` and `pg.view` go inside a `pg.schema`. A `pg.schema`
goes inside a `pg.database`. A `pg.database` goes inside a `pg.cluster`
(optional). A `react.route` goes inside a `react.app` or a `react.layout`. A
`node.route-handler` goes inside a `node.service` or a `node.module`.

---

## 2. Relations added by the profile

| Relation | From → To | Meaning |
|---|---|---|
| `migrates` | `node.service` / `node.worker` → `pg.schema` / `pg.database` | This element owns the DDL (migrations). Key for ownership rules. |
| `enqueues` | node element → `pg.job-queue` | Adds a job (specialization of `publishes`). Property: `inTransaction` (bool). |
| `processes` | `node.worker` → `pg.job-queue` | Runs jobs (specialization of `consumes`). |
| `notifies` / `listens` | node element → `pg.channel` | `NOTIFY` / `LISTEN`. |
| `connects-via` | node element → `pg.pooler` | Database connections go through a pooler. |
| `replicates-to` | `pg.database` → `pg.replica` | Physical / logical replication. |
| `serves` | `node.service` → `react.app` | The Node service serves the SPA build (static). |
| `uses-state` | react element → `react.client-store` / `react.server-state` | State dependency. |
| `fetches-via` | `react.server-state` / `react.hook` → `react.api-client` | Data fetching path. |

`calls` keeps a `protocol` property: `http`, `graphql`, `trpc`, `websocket`.
`reads` / `writes` keep a `via` property: the ORM.

### 2.1 Extra hard constraints (blocked)

| Attempt | Message |
|---|---|
| Any `react.*` → `reads`/`writes` any `pg.*` | "Browser code cannot connect to PostgreSQL. Go through a Node service." |
| `pg.*` → `calls` anything | "PostgreSQL does not call services. Did you mean the service *reads/writes* the database?" |
| `writes` → `pg.replica` | "Replicas are read-only. Write to the primary database." |
| `processes` from anything other than `node.worker` / `node.service` | "Only Node processes run jobs." |
| `migrates` from a `react.*` element | "Migrations run from backend code." |
| `pg.table` outside a `pg.schema` | "Tables live in a schema (default: `public`)." |
| `react.*` nested inside `node.service` | "Use the *serves* relation instead of nesting." |

---

## 3. Anti-pattern rules (pack `react-node-postgres`)

These come on top of the generic rules (AP-001 … AP-018 in PLAN.md section 7.2).
"Analyzer" means the code scan can detect the rule, so it also runs in CI.

| ID | Anti-pattern | Detection | Severity | Quick fix |
|---|---|---|---|---|
| RNP-001 | Shared tables between services | ≥2 Node services `write` the same `pg.schema` / `pg.table`. Separate databases or schemas on one cluster are fine. | warning | Give each service its own schema; expose data via API or events |
| RNP-002 | Several migration owners | ≥2 `migrates` edges to one schema; analyzer: two packages with migrations that touch the same tables | error | Pick one owner; others get read access via a view or API |
| RNP-003 | DB client in the frontend bundle | Analyzer: `pg`, `postgres`, `@prisma/client`, `drizzle-orm`, `typeorm`, `knex` imported (directly or transitively) from a `react.app` package | error | Move the code to a Node service; share only types/zod schemas |
| RNP-004 | Secrets exposed to the browser | Analyzer: `VITE_*` / `REACT_APP_*` env var whose name contains `DATABASE`, `SECRET`, `PRIVATE`, `SERVICE_ROLE`, `PASSWORD` | error | Move to server env; add a backend endpoint |
| RNP-005 | Route handler uses the ORM directly | In `layered` / `hexagonal` packs: `node.route-handler` reads/writes `pg.*` with no use case/repository in between; analyzer: controller file imports the Prisma client / Drizzle `db` | warning | Insert a use case + repository |
| RNP-006 | Domain depends on the ORM | `node.domain` depends on a repository implementation or ORM; analyzer: domain folder imports `@prisma/client` / `drizzle-orm` | warning | Add a port; the repository implements it |
| RNP-007 | Dual write | Service writes Postgres **and** calls an external system or non-Postgres broker in the same flow, with no outbox/job | warning | Use the Outbox template, or `enqueue` with `inTransaction: true` (pg-boss / graphile-worker can enqueue in the same transaction) |
| RNP-008 | Slow work in the request path | Scenario: sync chain from a route to an external system marked `slow`, or a handler with "batch/export/report" responsibility and no worker | info | Move to a `pg.job-queue` + `node.worker` |
| RNP-009 | No connection pooling at scale | `node.service` with `scaling: horizontal` or `serverless` and no `connects-via` pooler | warning | Add PgBouncer (transaction mode) or a managed pooler |
| RNP-010 | NOTIFY used for durable work | `pg.channel` consumed by a worker that does business-critical jobs | info | NOTIFY is not durable. Use `pg.job-queue` |
| RNP-011 | Frontend calls many services | `react.app` calls >2 Node services directly | warning | Add a Node BFF (template T5) |
| RNP-012 | Server data in the client store | `react.api-client` → `react.client-store` write path while a server-state lib exists; analyzer: `createAsyncThunk` / fetch in Zustand actions together with TanStack Query | info | Keep server data in the server-state cache |
| RNP-013 | React layer direction violation | FSD order `app > pages > widgets > features > entities > shared`: a lower layer imports a higher one; analyzer via import graph | warning | Move code down, or invert via props/slots |
| RNP-014 | Feature-to-feature imports | `react.feature` depends on another `react.feature` (FSD) | warning | Lift shared code to `entities` / `shared` |
| RNP-015 | No validation at the boundary | `node.route-handler` with no `validation` property, and no zod / joi / class-validator found by the analyzer | info | Add schema validation; share zod schemas via `node.contract` |
| RNP-016 | Public service without auth | Path actor → `node.service` with no auth middleware / `authenticates-with` | warning | Add an auth middleware or gateway |
| RNP-017 | Missing indexes on FKs | Introspection / schema: a foreign key column with no index | info | Add an index (migration snippet) |
| RNP-018 | Cycles between Node modules | Import cycle between `node.module`s (NestJS `forwardRef` is a hint) | warning | Extract a shared module or use events |

---

## 4. Templates (v1 set)

Each template has parameters, rule packs, invariants (exported to agents), and
an "expected folder layout" used for enforcement and scaffolding.

| ID | Template | Shape of the result | Rule packs |
|---|---|---|---|
| T1 | **Starter**: React (Vite) + Express REST + Postgres (Prisma) | `react.app` → `node.service` → `pg.database`; `serves` optional | core, frontend |
| T2 | **Layered Node API** | routes → controllers → services → repositories → Postgres | core, layered |
| T3 | **Hexagonal Node service** | HTTP adapter → use cases → domain + ports ← Prisma/Drizzle adapters → Postgres | core, hexagonal |
| T4 | **NestJS modular monolith** | modules with public APIs, one database, **one schema per module**, one migration owner per schema | core, modular-monolith |
| T5 | **React + Node BFF** | React → BFF → 2+ internal Node services, each with its own schema | core, microservices, frontend |
| T6 | **Node services, database per service** | API gateway (nginx/Traefik) → N services → own databases on one cluster, pg-boss for async | core, microservices |
| T7 | **Background jobs on Postgres** | API `enqueues` (in transaction) → `pg.job-queue` → `node.worker` → Postgres / external | core, event-driven |
| T8 | **Transactional outbox on Postgres** | service writes data + `outbox` table in one transaction → relay worker → consumers | core, event-driven |
| T9 | **CQRS-lite on Postgres** | write tables → projections / materialized views → read API | core, cqrs |
| T10 | **Realtime** | React ↔ Socket.IO gateway; Postgres `LISTEN/NOTIFY` fan-out; durable work via job queue | core, event-driven |
| T11 | **Feature-Sliced React app** | `app / pages / widgets / features / entities / shared`, TanStack Query, API client layer | frontend, fsd |
| T12 | **Type-safe monorepo** | React + tRPC (or OpenAPI-generated client) + shared zod `node.contract` + Node + Postgres (Drizzle) | core, frontend |
| T13 | **Multi-tenant SaaS** | parameter: `rls` (tenant_id + Row Level Security) or `schema-per-tenant` | core, security |

Example invariants exported with T3 (Hexagonal):

```
- node.domain MUST NOT import @prisma/client, drizzle-orm, express, fastify.
- Persistence MUST go through a node.port; node.repository implements it.
- node.route-handler MUST call a node.use-case, never a node.repository.
- Folder layout: src/domain, src/application, src/adapters/{http,db}.
```

---

## 5. Analyzer detectors (JS/TS only)

Engine: **dependency-cruiser** (programmatic `cruise()`) for the import graph
(resolves `tsconfig` paths and workspaces), **ts-morph** for framework-specific
AST patterns, small parsers for manifests and configs. Everything runs locally.

### 5.1 Workspace and packages

| Signal | Result |
|---|---|
| `package.json` `workspaces`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json` | List of packages; each is a candidate deployable or library |
| Dependencies: `react` + `vite` | `react.app` |
| Dependencies: `express` / `fastify` / `@nestjs/core` + a `listen(` call | `node.service` (framework set) |
| Dependencies: `pg-boss` `work(` / `graphile-worker` task list | `node.worker` + `pg.job-queue` |
| A package imported by others, with no entry point | `node.shared-lib` / `react.design-system` / `node.contract` (if it exports zod / OpenAPI / tRPC router) |

### 5.2 React

| Signal | Result |
|---|---|
| `createBrowserRouter([...])`, `<Route path=...>`, TanStack Router `src/routes/**` | `react.route`, `react.layout` (with paths) |
| Folders `features/`, `entities/`, `widgets/`, `shared/`, `pages/` | `react.feature` and FSD layer tags |
| `@tanstack/react-query`, `swr`, `@reduxjs/toolkit/query`, `@apollo/client` | `react.server-state` |
| `zustand`, `@reduxjs/toolkit`, `createContext` stores | `react.client-store` |
| `axios.create({ baseURL })`, fetch wrapper, OpenAPI-generated client, `@trpc/client` | `react.api-client` |
| `vite.config.*` `server.proxy` targets, `VITE_API_URL` in `.env*` | `calls` edge from `react.app` to the matching `node.service` (matched by port / compose service name) |

### 5.3 Node.js

| Signal | Result |
|---|---|
| Express `Router()`, `app.use('/api', r)`, `r.get(...)`; Fastify `register` / route objects | `node.route-handler` with route list |
| NestJS `@Module({ imports, controllers, providers, exports })` | Exact `node.module` graph, controllers, providers |
| Middleware: `passport`, `express-jwt`, `@nestjs/passport`, Clerk / Auth0 SDKs | `node.middleware` (auth) + external auth provider |
| Validation: `zod`, `joi`, `class-validator`, `@fastify/type-provider-*` | `validation` property on handlers |
| SDKs: `stripe`, `@sendgrid/mail`, `@aws-sdk/*`, `@anthropic-ai/sdk`, `openai` ... | External system + `calls` edge |
| Outbound HTTP to other services (base URL env vars) | `calls` between Node services |
| Folder conventions: `domain/`, `application/`, `use-cases/`, `adapters/`, `ports/`, `infra/`, `repositories/`, `controllers/` | Layer tags; candidate `node.domain`, `node.port`, `node.repository`, `node.use-case` |

### 5.4 PostgreSQL

| Signal | Result |
|---|---|
| `schema.prisma` (datasource `postgresql`, `@@schema`, models, relations) | `pg.database`, `pg.schema`, `pg.table` + FKs |
| Drizzle `pgTable(` / `pgSchema(` calls | Same |
| TypeORM `@Entity`, Knex / node-pg-migrate migrations, raw `.sql` files (parsed with `libpg-query`) | Same |
| Migration folders (`prisma/migrations`, `drizzle/`, `migrations/`) per package | `migrates` edges → ownership (RNP-002) |
| ORM usage per package: `prisma.order.findMany` (read), `create`/`update`/`delete`/`upsert` (write); Drizzle `db.select().from(orders)` / `insert(orders)` | **Data ownership map**: `reads` / `writes` edges from services to tables |
| `pg-boss` `send` / `work`, graphile-worker `addJob` | `enqueues` / `processes` |
| `LISTEN` / `NOTIFY` in SQL or `pg` client | `pg.channel` + `listens` / `notifies` |
| `docker-compose.yml` `postgres` image, `pgbouncer` image | `pg.cluster`, `pg.pooler` |
| **Optional live introspection** (read-only connection string, `pg_catalog` via pg-introspection) | Real tables, FKs, indexes, RLS flags, extensions (RNP-017) |

Every fact has `evidence` (file + line) and a `confidence` value. Elements also
get `codePaths` (globs). Enforcement needs them (section 6).

---

## 6. Enforcement generated from the model

`archguide check` runs two layers:

1. **Generated dependency-cruiser rules.** Element `codePaths` + invariants are
   compiled into `.archguide/dependency-cruiser.cjs`. Example for T3:

   ```js
   // generated by archguide from architecture/orders.archguide.json, do not edit
   module.exports = {
     forbidden: [
       {
         name: 'AG-hexagonal-domain-no-infra',
         comment: 'node.domain MUST NOT depend on adapters or ORMs (orders.archguide.json)',
         severity: 'error',
         from: { path: '^services/orders/src/domain' },
         to:   { path: '^(services/orders/src/adapters|node_modules/(@prisma/client|drizzle-orm|express|fastify))' },
       },
       {
         name: 'AG-no-db-client-in-frontend',
         severity: 'error',
         from: { path: '^apps/web/src' },
         to:   { path: 'node_modules/(pg|postgres|@prisma/client|drizzle-orm|typeorm|knex)/' },
       },
       { name: 'AG-no-circular', severity: 'warn', from: {}, to: { circular: true } },
     ],
     options: { tsConfig: { fileName: 'tsconfig.json' } },
   };
   ```

2. **Model-aware checks** that dependency-cruiser cannot express: data
   ownership (RNP-001/002 from ORM usage), secrets in browser env (RNP-004),
   drift (elements in code but not in the model, and the reverse).

Optional generators: Nx `depConstraints` (from element tags) and an ArchUnitTS
`architecture.spec.ts`.

---

## 7. Test corpus

- Fixture repos under `packages/analyzer/fixtures/`:
  1. Vite React + Express + Prisma (T1 shape)
  2. NestJS modular monolith + Drizzle, schema per module (T4)
  3. pnpm monorepo: React + BFF + 2 services + pg-boss worker (T5 + T7)
  4. A **bad** repo that contains one example of each RNP rule
- Public sample apps (for example, React and Node implementations of the
  RealWorld "Conduit" app) as a smoke-test corpus. These are not committed;
  the test downloads them at a pinned commit.
