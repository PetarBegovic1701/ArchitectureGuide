# Onboarding: Type-safe monorepo

One repository: the React app and the Node service share an API contract (tRPC router types or an OpenAPI document with zod schemas), so a breaking API change fails the build. Drizzle maps the tables.

This guide is written for the **intermediate** level. Open the project in ArchitectureGuide to see the diagram, follow the tour, and read every concept at your level.

## The big picture

```mermaid
flowchart LR
  actor__customer(["Customer<br/><small>User / actor</small>"])
  api__app_router_types(("App router (types)<br/><small>API contract package</small>"))
  subgraph app__web["Web"]
    apic__trpc_client[["tRPC client<br/><small>API client</small>"]]
    qcache__server_state_cache[("Server-state cache<br/><small>Server-state cache</small>")]
    route__orders["Orders<br/><small>Route / page</small>"]
  end
  subgraph db__app_db["App DB"]
    schema__public[("public<br/><small>Schema</small>")]
  end
  subgraph svc__api["API"]
    ctl__order_procedures("Order procedures<br/><small>Controller / route handler</small>")
    mw__auth_middleware("Auth middleware<br/><small>Middleware</small>")
  end
  actor__customer -->|"calls"| app__web
  apic__trpc_client -->|"calls"| svc__api
  apic__trpc_client -->|"depends on"| api__app_router_types
  ctl__order_procedures -->|"depends on"| api__app_router_types
  ctl__order_procedures -->|"reads"| schema__public
  ctl__order_procedures ==>|"writes"| schema__public
  qcache__server_state_cache -->|"fetches via"| apic__trpc_client
  route__orders -->|"uses state"| qcache__server_state_cache
  svc__api -->|"migrates"| schema__public
```

## Tour of Type-safe monorepo

1. **One contract**: The contract defines every request and response once. The server implements it; the client is typed from it, so a breaking change fails the build.

   Look at: App router (types), tRPC client, Order procedures.

## Patterns used

### Type-safe monorepo

The React app and the Node API live in one repository and share one API contract (tRPC router types or an OpenAPI document with zod schemas), so a breaking change fails the build.

- Put the contract in its own package (`packages/contract`) with only zod schemas and
  types — no server code, no database client.
- Validate every request on the server with the same schemas.
- The app calls the API only through the typed client; no hand-written `fetch` calls.
- Drizzle gives typed queries and migrations (drizzle-kit) on the server side.
- Build and type-check the workspace in CI, so a contract change is checked against
  every consumer.

## Who owns which data

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.public | svc.api | svc.api | svc.api |

## Rules of the road

- The app MUST call the API only through the generated or typed API client.
- Request and response shapes MUST be defined once, in packages/contract, and validated on the server.
- Browser code MUST NOT import server code; it MAY import the contract package.
- Only `svc.api` MAY write `schema.public`. Only `svc.api` MAY run migrations on it.

## Concepts used in this project

- **User / actor** (`gen.actor`): A person or role that uses the system — customer, admin, support agent. Diagrams start with who uses the system and why.

  - Name actors by role, not by person ("Support agent", not "Anna").
  - Actors call **apps**, not databases. If an actor talks to an external tool (a payment
    page), draw that too.
  - Roles on actors map to roles in authorization (RBAC).
- **API contract package** (`node.contract`): The shared description of an API — OpenAPI, zod schemas, a tRPC router type — that both the client and the server use, so they cannot drift apart.

  - **Contract-first:** write `openapi.yaml`, generate server stubs and the client.
  - **Code-first:** write zod schemas or a tRPC router, and derive types and docs from them.
  - Put endpoints and their data shapes (DTOs) inside the contract shape on the canvas.
  - Browser code may depend on the contract package; it may not depend on server code.
- **Middleware** (`node.middleware`): Code that runs before (or after) every handler of a route group — authentication, rate limiting, request logging, error handling.

  - **Auth middleware** answers "who is calling?": it reads the session cookie or the
    bearer token, verifies it, and attaches the user to the request.
  - **Authorization** ("may this user cancel _this_ order?") usually needs the data, so it
    belongs in the use case, not only in middleware.
  - Order matters: logging and request IDs first, then auth, then validation, then the
    handler, then the error handler last.
- **Controller / route handler** (`node.route-handler`): Code that receives an HTTP request, validates it, calls the business logic, and turns the result into an HTTP response. Thin by design.

  - Validate with a schema (zod, TypeBox, class-validator) and return 400 with details on
    failure (RNP-015 flags handlers without validation).
  - Map domain errors to HTTP: "out of stock" → 409, "not found" → 404.
  - One handler groups the endpoints of one resource (`/orders`, `/orders/:id`).
- **Node service** (`node.service`): A Node.js process that answers requests. It checks who is calling, validates input, applies business rules, and is the only part that talks to the database.

  - Inside a service you usually find **route handlers** (HTTP in and out), **use cases**
    (one business action each) and **repositories** (database access).
  - Configure it with environment variables; keep secrets out of the code.
  - Run several **instances** behind a load balancer for availability; each has its own
    database **connection pool**.
  - Return clear errors: 400 for bad input, 401/403 for auth, 404, 409 for conflicts.
- **Database** (`pg.database`): A PostgreSQL database — the place where data survives restarts. Only backend code connects to it; schemas inside it group tables by owner.

  - Use transactions for changes that belong together.
  - Run schema changes as **migrations** owned by one service.
  - Back up regularly and test restores.
  - One database can serve several services if each owns its own schema; or each service
    gets its own database (database per service).
- **Schema** (`pg.schema`): A namespace of tables inside a database. In this tool it is also the ownership boundary — one service owns a schema and runs its migrations.

  - **Migrations** are versioned scripts (Prisma Migrate, Drizzle Kit, node-pg-migrate) that
    create and change tables. Exactly one owner runs them.
  - Other services that need the data call the owner's API, or read a published view or
    replica.
  - Database roles per service (`GRANT USAGE ON SCHEMA orders TO orders_app`) enforce the
    boundary.
  - **Row Level Security** (`rls`) restricts rows per user or tenant inside the database.
- **API client** (`react.api-client`): The one place in the frontend that talks HTTP to the backend — base URL, auth, error handling, and request and response types.

  - Turn HTTP errors into typed errors (status, problem details), so the UI can show a good
    message and retry where it makes sense.
  - Send cookies (`credentials: 'include'`) or tokens in one place.
  - Generate the client from the API contract (OpenAPI, tRPC, GraphQL codegen), so types
    match the server.
  - The server-state cache, hooks and thunks use the client; components do not call it
    directly.
- **React app** (`react.app`): The part of the system that runs in the browser. It draws the screens and sends requests to the backend; it never holds secrets.

  - **Build:** Vite bundles the code into static files. Any static host (a CDN, or the
    Node service with the `serves` relation) can deliver them.
  - **Routing:** a router (React Router, TanStack Router) maps URLs to pages without a full
    page load.
  - **State:** server data in a server-state cache (TanStack Query), shared UI state in a
    small store, the rest in components.
  - **Config:** `import.meta.env.VITE_*` values are baked into the bundle at build time.
    They are public.
  - **Validation in the browser is for comfort only.** The API must validate everything
    again.
- **Route / page** (`react.route`): A screen reachable by URL. The router picks the page for the current address, so links, the back button and bookmarks work.

  - **Parameters:** `/orders/:id` gives the page the order ID; search parameters
    (`?page=2&sort=price`) keep list state in the URL, so it survives a reload.
  - **Lazy routes** load their code only when visited, which keeps the first download small.
  - **Protected routes** redirect to sign-in when there is no session. This is only a
    convenience: the API must still check every request.
  - Load data per route (a loader, or a query hook at the top of the page) and show
    loading and error states.
- **Server-state cache** (`react.server-state`): Data that belongs to the server (orders, users) needs caching and refetching; data that belongs to the UI (open dialogs, drafts) needs a simple store. Mixing them causes stale screens.

  - Each query has a **key** (`['orders', userId]`). Same key = same cached data, shared by
    every component that asks for it.
  - **staleTime** says how long cached data counts as fresh (TanStack Query's default is 0:
    refetch on mount, window focus and reconnect).
  - After a change (**mutation**), **invalidate** the affected keys so they refetch.
  - **Optimistic update:** change the cache immediately, roll back if the server says no.
    Good for toggles and likes, risky for payments.
  - Keep state as **local** as you can; lift it up only when two components need it.
  - Derived values (totals, filtered lists) are computed during render, not stored.
- **calls** (`calls`): A synchronous request and response — the caller waits for the answer. Set the protocol, auth, timeout and whether it is safe to retry.

  - Properties on the arrow document the decisions: `protocol` (http, graphql, trpc),
    `auth` (session cookie, bearer token, API key), `timeoutMs`, `idempotent`,
    `idempotencyKey`.
  - Every call needs a timeout.
  - Retry only idempotent calls, or send an idempotency key.
- **depends on** (`depends-on`): A compile-time import — one module uses another's code. The direction of these arrows is the architecture.

  - Arrows should point toward stable things: features → shared, handlers → use cases →
    domain.
  - Browser code must not depend on server code (this tool refuses it); share types through
    a contract package.
  - Cycles (A → B → A) mean the boundary is wrong.
- **fetches via** (`fetches-via`): React code loads data through the API client — a query, a thunk or an effect calls the backend.

  - Prefer fetching from a server-state cache (queries) over effects and thunks; it handles
    caching, retries and deduplication.
  - All calls go through the one API client, never `fetch` scattered in components.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.

  - Run migrations in the deploy pipeline before the new code starts.
  - Make them backward compatible (expand and contract) so old and new code can run at the
    same time.
- **reads** (`reads`): Code reads data from a store. Set via (the data-access library) and, where it matters, the isolation level.

  - `via` names the library (prisma, drizzle, kysely, pg).
  - Reading another service's tables couples you to its schema; prefer its API or a
    published view.
  - Reads can go to a replica when slightly old data is fine.
- **uses state** (`uses-state`): React code reads or updates a client store or a server-state cache — a component reads the cart with a selector, a page reads orders from the query cache.

  - Read with selectors so only the parts you need trigger re-renders.
  - Changes go through actions (`dispatches` → action → `updates`), not direct writes.
- **writes** (`writes`): Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.

  - `concurrencyControl` documents how concurrent writers are kept apart: `none`,
    `optimistic-version`, `row-lock`, `advisory-lock`, `serializable-retry`.
  - `isolation` documents the transaction isolation level.
  - Writes that belong together go in one transaction.
