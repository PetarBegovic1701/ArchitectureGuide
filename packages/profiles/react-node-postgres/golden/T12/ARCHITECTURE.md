---
archguide: 1
project: type-safe-monorepo
profile: react-node-postgres
patterns: [type-safe-monorepo]
revision: 0
generated: 2026-10-27
---

# Architecture: Type-safe monorepo

One repository: the React app and the Node service share an API contract (tRPC router types or an OpenAPI document with zod schemas), so a breaking API change fails the build. Drizzle maps the tables.

## Elements

| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |
|---|---|---|---|---|---|---|---|
| actor.customer | gen.actor | Customer | – | – | – | – | – |
| apic.trpc-client | react.api-client | tRPC client | app.web | presentation | – | – | – |
| app.web | react.app | Web | – | presentation | – | – | apps/web/** |
| qcache.server-state-cache | react.server-state | Server-state cache | app.web | presentation | – | – | – |
| route.orders | react.route | Orders | app.web | presentation | – | – | – |
| ctl.order-procedures | node.route-handler | Order procedures | svc.api | application | – | – | – |
| mw.auth-middleware | node.middleware | Auth middleware | svc.api | application | – | Read the session cookie; Reject calls without a valid session | – |
| svc.api | node.service | API | – | application | – | – | apps/api/** |
| api.app-router-types | node.contract | App router (types) | – | domain | – | Request and response shapes (zod) | packages/contract/** |
| db.app-db | pg.database | App DB | – | data | – | – | – |
| schema.public | pg.schema | public | db.app-db | data | – | – | – |

## Relations

| From | Relation | To | Details |
|---|---|---|---|
| actor.customer | calls | app.web | https |
| apic.trpc-client | calls | svc.api | https |
| apic.trpc-client | depends-on | api.app-router-types | – |
| ctl.order-procedures | depends-on | api.app-router-types | – |
| ctl.order-procedures | reads | schema.public | via drizzle |
| ctl.order-procedures | writes | schema.public | via drizzle |
| qcache.server-state-cache | fetches-via | apic.trpc-client | – |
| route.orders | uses-state | qcache.server-state-cache | – |
| svc.api | migrates | schema.public | – |

## Data ownership

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.public | svc.api | svc.api | svc.api |

## Invariants

- The app MUST call the API only through the generated or typed API client. (T12)
- Request and response shapes MUST be defined once, in packages/contract, and validated on the server. (T12)
- Browser code MUST NOT import server code; it MAY import the contract package. (T12)
- Only `svc.api` MAY write `schema.public`. Only `svc.api` MAY run migrations on it. (ownership)
- Browser code MUST NOT read or write a database directly. (AP-002)
- Modules MUST NOT depend on each other in a cycle. (AP-003)
- Services MUST NOT call each other synchronously in a cycle. (AP-006)
- Synchronous call chains between services MUST stay at most 4 services long. (AP-007)
- Sensitive data (PII, secrets) MUST NOT be reachable from browser code. (AP-015)
- Each PostgreSQL schema MUST have one writing service; other services use its API or events. (RNP-001)
- Each schema MUST have exactly one migration owner. (RNP-002)
- Horizontally scaled or serverless services MUST connect to PostgreSQL through a connection pooler. (RNP-009)
- The React app MUST call at most 2 Node services directly; use a BFF beyond that. (RNP-011)
- Route handlers MUST validate every request with a schema (zod or similar). (RNP-015)
- Services reachable from the browser MUST authenticate callers (auth middleware, gateway or auth provider). (RNP-016)
- Writes to rows that several writers change MUST use a row lock or an optimistic version check. (RNP-019)
- The connection pools of all services together MUST stay below 80% of max_connections, or go through a pooler. (RNP-020)
- CPU-heavy work MUST NOT run on the event loop of a request-serving process; use worker threads or a worker. (RNP-021)
- Serializable transactions MUST be retried on SQLSTATE 40001. (RNP-022)
- Auth tokens MUST NOT be stored in localStorage or sessionStorage. (RNP-026)

## Concepts

- **User / actor** (`gen.actor`): A person or role that uses the system — customer, admin, support agent. Diagrams start with who uses the system and why.
- **API contract package** (`node.contract`): The shared description of an API — OpenAPI, zod schemas, a tRPC router type — that both the client and the server use, so they cannot drift apart.
- **Middleware** (`node.middleware`): Code that runs before (or after) every handler of a route group — authentication, rate limiting, request logging, error handling.
- **Controller / route handler** (`node.route-handler`): Code that receives an HTTP request, validates it, calls the business logic, and turns the result into an HTTP response. Thin by design.
- **Node service** (`node.service`): A Node.js process that answers requests. It checks who is calling, validates input, applies business rules, and is the only part that talks to the database.
- **Database** (`pg.database`): A PostgreSQL database — the place where data survives restarts. Only backend code connects to it; schemas inside it group tables by owner.
- **Schema** (`pg.schema`): A namespace of tables inside a database. In this tool it is also the ownership boundary — one service owns a schema and runs its migrations.
- **API client** (`react.api-client`): The one place in the frontend that talks HTTP to the backend — base URL, auth, error handling, and request and response types.
- **React app** (`react.app`): The part of the system that runs in the browser. It draws the screens and sends requests to the backend; it never holds secrets.
- **Route / page** (`react.route`): A screen reachable by URL. The router picks the page for the current address, so links, the back button and bookmarks work.
- **Server-state cache** (`react.server-state`): Data that belongs to the server (orders, users) needs caching and refetching; data that belongs to the UI (open dialogs, drafts) needs a simple store. Mixing them causes stale screens.
- **calls** (`calls`): A synchronous request and response — the caller waits for the answer. Set the protocol, auth, timeout and whether it is safe to retry.
- **depends on** (`depends-on`): A compile-time import — one module uses another's code. The direction of these arrows is the architecture.
- **fetches via** (`fetches-via`): React code loads data through the API client — a query, a thunk or an effect calls the backend.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.
- **reads** (`reads`): Code reads data from a store. Set via (the data-access library) and, where it matters, the isolation level.
- **uses state** (`uses-state`): React code reads or updates a client store or a server-state cache — a component reads the cart with a selector, a page reads orders from the query cache.
- **writes** (`writes`): Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.
