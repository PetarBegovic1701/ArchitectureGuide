# Onboarding: Layered Node API

Each entity gets a route handler, a use case and a repository. Requests go down the layers, never around them.

This guide is written for the **intermediate** level. Open the project in ArchitectureGuide to see the diagram, follow the tour, and read every concept at your level.

## The big picture

```mermaid
flowchart LR
  actor__api_client(["API client<br/><small>User / actor</small>"])
  subgraph db__database["Database"]
    subgraph schema__app["app"]
      tbl__customers["customers<br/><small>Table</small>"]
      tbl__orders["orders<br/><small>Table</small>"]
    end
  end
  subgraph svc__orders_api["Orders API"]
    ctl__customer_routes("Customer routes<br/><small>Controller / route handler</small>")
    ctl__order_routes("Order routes<br/><small>Controller / route handler</small>")
    mw__auth_middleware("Auth middleware<br/><small>Middleware</small>")
    repo__customer_repository[["Customer repository<br/><small>Repository / data access</small>"]]
    repo__order_repository[["Order repository<br/><small>Repository / data access</small>"]]
    uc__customer_service("Customer service<br/><small>Use case / application service</small>")
    uc__order_service("Order service<br/><small>Use case / application service</small>")
  end
  actor__api_client -->|"calls"| svc__orders_api
  ctl__customer_routes -->|"calls"| uc__customer_service
  ctl__order_routes -->|"calls"| uc__order_service
  repo__customer_repository -->|"reads"| tbl__customers
  repo__customer_repository ==>|"writes"| tbl__customers
  repo__order_repository -->|"reads"| tbl__orders
  repo__order_repository ==>|"writes"| tbl__orders
  svc__orders_api -->|"migrates"| schema__app
  uc__customer_service -->|"calls"| repo__customer_repository
  uc__order_service -->|"calls"| repo__order_repository
```

## Tour of Layered Node API

1. **Three layers**: Route handlers turn HTTP into calls, use cases hold the rules, repositories talk to the database.

   Look at: Order routes, Order service, Order repository.
2. **One way down**: A request goes handler → use case → repository → table. A handler that queries the database itself skips the rules (RNP-005).
3. **Tables per entity**: Each of Order, Customer has its own table and its own repository, so database code for one entity lives in one place.

   Look at: app.

## Patterns used

### Layered architecture

Code is split into presentation, application and data-access layers. Each layer calls only the layer below it.

- Handlers stay thin: no queries, no rules. If a handler is longer than the use case it
  calls, rules are leaking upwards.
- One repository per entity (or per aggregate). Use cases can call several
  repositories inside one transaction; pass the transaction down.
- Errors travel up as typed results or domain errors (`OrderNotFound`), and only the
  handler maps them to HTTP status codes.
- Test use cases with fake repositories; test repositories against a real PostgreSQL
  (Testcontainers or a test database).

## Who owns which data

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.app | svc.orders-api | svc.orders-api | svc.orders-api |

## Rules of the road

- A node.route-handler in Orders API MUST call a node.use-case, never a repository or the database.
- Only node.repository code MAY import the database client.
- Each of Order, Customer has exactly one repository.
- Only `svc.orders-api` MAY write `schema.app`. Only `svc.orders-api` MAY run migrations on it.

## Concepts used in this project

- **User / actor** (`gen.actor`): A person or role that uses the system — customer, admin, support agent. Diagrams start with who uses the system and why.

  - Name actors by role, not by person ("Support agent", not "Anna").
  - Actors call **apps**, not databases. If an actor talks to an external tool (a payment
    page), draw that too.
  - Roles on actors map to roles in authorization (RBAC).
- **Middleware** (`node.middleware`): Code that runs before (or after) every handler of a route group — authentication, rate limiting, request logging, error handling.

  - **Auth middleware** answers "who is calling?": it reads the session cookie or the
    bearer token, verifies it, and attaches the user to the request.
  - **Authorization** ("may this user cancel _this_ order?") usually needs the data, so it
    belongs in the use case, not only in middleware.
  - Order matters: logging and request IDs first, then auth, then validation, then the
    handler, then the error handler last.
- **Repository / data access** (`node.repository`): The code that reads and writes the database through an ORM or query builder (Prisma, Drizzle, Kysely), so the rest of the app does not write SQL.

  - One repository per aggregate or table group (orders, products).
  - Pass the transaction in (`tx`) so a use case can make several calls atomic.
  - Watch for **N+1 queries**: loading 50 orders, then each order's lines one by one.
    Load them together (`include`, a join, or `WHERE id = ANY($1)`).
  - Paginate list queries.
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
- **Use case / application service** (`node.use-case`): One business action — PlaceOrder, RefundOrder — as one function or class. It loads data, asks the domain to apply the rules, saves, and starts follow-up work.

  - One use case = one **transaction** boundary in most designs: either everything is saved
    or nothing.
  - It depends on **ports** (interfaces like `OrderRepository`) or on repositories directly
    in a layered design, never on HTTP objects.
  - Return a result or a domain error; let the handler choose the status code.
  - Enqueue follow-up jobs in the same transaction.
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
- **Table** (`pg.table`): Tables store your data; keys, constraints and indexes keep it correct and fast.

  - **Normalize first:** store each fact once (the customer's email lives in `customers`,
    not copied into every order). Denormalize later, on purpose, for read speed.
  - **Keys:** `bigint GENERATED ALWAYS AS IDENTITY` is simple and compact; UUIDs (v7 sorts by
    time) help when IDs are created outside the database or must not be guessable.
  - **Foreign keys:** choose `ON DELETE` on purpose: `RESTRICT` (default, safest),
    `CASCADE` (delete children), `SET NULL`.
  - **Index foreign key columns** you join or filter on; PostgreSQL does not do it for you.
  - **Types:** `timestamptz` for points in time, `numeric` or integer cents for money,
    `text` with a `CHECK` (or an enum) for statuses, `jsonb` only for truly flexible data.
  - One service owns the migrations of a schema. Other services read through an API or a view.
- **calls** (`calls`): A synchronous request and response — the caller waits for the answer. Set the protocol, auth, timeout and whether it is safe to retry.

  - Properties on the arrow document the decisions: `protocol` (http, graphql, trpc),
    `auth` (session cookie, bearer token, API key), `timeoutMs`, `idempotent`,
    `idempotencyKey`.
  - Every call needs a timeout.
  - Retry only idempotent calls, or send an idempotency key.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.

  - Run migrations in the deploy pipeline before the new code starts.
  - Make them backward compatible (expand and contract) so old and new code can run at the
    same time.
- **reads** (`reads`): Code reads data from a store. Set via (the data-access library) and, where it matters, the isolation level.

  - `via` names the library (prisma, drizzle, kysely, pg).
  - Reading another service's tables couples you to its schema; prefer its API or a
    published view.
  - Reads can go to a replica when slightly old data is fine.
- **writes** (`writes`): Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.

  - `concurrencyControl` documents how concurrent writers are kept apart: `none`,
    `optimistic-version`, `row-lock`, `advisory-lock`, `serializable-retry`.
  - `isolation` documents the transaction isolation level.
  - Writes that belong together go in one transaction.
