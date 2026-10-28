# Onboarding: Hexagonal Node service

The domain is in the middle and depends on nothing. Use cases call ports (interfaces); adapters implement them for HTTP and the database.

This guide is written for the **intermediate** level. Open the project in ArchitectureGuide to see the diagram, follow the tour, and read every concept at your level.

## The big picture

```mermaid
flowchart LR
  actor__api_client(["API client<br/><small>User / actor</small>"])
  subgraph db__database["Database"]
    subgraph schema__orders["orders"]
      tbl__orders["orders<br/><small>Table</small>"]
    end
  end
  subgraph svc__orders["Orders"]
    ctl__order_http_adapter("Order HTTP adapter<br/><small>Controller / route handler</small>")
    dom__order{{"Order<br/><small>Domain model / aggregate</small>"}}
    mw__auth_middleware("Auth middleware<br/><small>Middleware</small>")
    port__order_repository_port(("Order repository port<br/><small>Port (interface)</small>"))
    repo__order_repository_prisma[["Order repository (prisma)<br/><small>Repository / data access</small>"]]
    uc__place_order("Place order<br/><small>Use case / application service</small>")
  end
  actor__api_client -->|"calls"| svc__orders
  ctl__order_http_adapter -->|"calls"| uc__place_order
  repo__order_repository_prisma -->|"implements"| port__order_repository_port
  repo__order_repository_prisma -->|"reads"| tbl__orders
  repo__order_repository_prisma ==>|"writes"| tbl__orders
  svc__orders -->|"migrates"| schema__orders
  uc__place_order -->|"depends on"| dom__order
  uc__place_order -->|"uses port"| port__order_repository_port
```

## Tour of Hexagonal Node service

1. **The domain in the middle**: The Order domain model holds the rules and imports nothing: no ORM, no HTTP.

   Look at: Order.
2. **Ports and adapters**: The use case asks for a port (an interface). The repository adapter implements it with prisma. Tests use an in-memory adapter instead.

   Look at: Order repository port, Order repository (prisma).
3. **Entry point**: The HTTP adapter validates input and calls the use case. Other entry points (a queue, a CLI) would call the same use case.

   Look at: Order HTTP adapter, Place order.

## Patterns used

### Hexagonal architecture (ports and adapters)

The domain sits in the middle and depends on nothing. It talks to the outside through ports (interfaces) that adapters implement.

- Dependencies point inwards: adapters → application → domain. The domain imports no
  framework or ORM. Check it automatically (dependency-cruiser rule on
  `src/domain/**`).
- Use cases orchestrate: load through a port, call domain methods, save through a port,
  publish events.
- Map at the edges: request DTO → command, entity → row, entity → response. The
  mapping code is the price of independence.
- Transactions: a "unit of work" port, or a repository method that saves an aggregate
  atomically.

## Who owns which data

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.orders | svc.orders | svc.orders | svc.orders |

## Rules of the road

- `services/orders/src/domain` MUST NOT import @prisma/client, drizzle-orm, kysely, express or any adapter.
- Persistence MUST go through a node.port; node.repository implements it.
- node.route-handler MUST call a node.use-case, never a node.repository.
- Only `svc.orders` MAY write `schema.orders`. Only `svc.orders` MAY run migrations on it.

## Concepts used in this project

- **User / actor** (`gen.actor`): A person or role that uses the system — customer, admin, support agent. Diagrams start with who uses the system and why.

  - Name actors by role, not by person ("Support agent", not "Anna").
  - Actors call **apps**, not databases. If an actor talks to an external tool (a payment
    page), draw that too.
  - Roles on actors map to roles in authorization (RBAC).
- **Domain model / aggregate** (`node.domain`): The business rules and state, written as plain code without database or HTTP — an Order that refuses to ship before it is paid.

  - An **aggregate** is a cluster of objects changed together and saved together (an Order
    with its lines). Other code changes it only through its methods.
  - **Value objects** (Money, Email) validate themselves and are compared by value.
  - The domain may **emit events** (`OrderPlaced`) that other parts react to.
  - It does not read or write the database; a repository loads and saves it (this tool
    refuses `reads`/`writes` from domain shapes).
- **Middleware** (`node.middleware`): Code that runs before (or after) every handler of a route group — authentication, rate limiting, request logging, error handling.

  - **Auth middleware** answers "who is calling?": it reads the session cookie or the
    bearer token, verifies it, and attaches the user to the request.
  - **Authorization** ("may this user cancel _this_ order?") usually needs the data, so it
    belongs in the use case, not only in middleware.
  - Order matters: logging and request IDs first, then auth, then validation, then the
    handler, then the error handler last.
- **Port (interface)** (`node.port`): An interface the application needs — OrderRepository, PaymentGateway — written in its own terms. Adapters implement it with a real database or service.

  - Ports are named in business terms (`OrderRepository.findById`), not technical ones
    (`PrismaClient`).
  - Use cases **use ports**; adapters **implement** them (`implements` relation).
  - Wire adapters to ports at startup (manual wiring or a DI container like NestJS).
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
- **depends on** (`depends-on`): A compile-time import — one module uses another's code. The direction of these arrows is the architecture.

  - Arrows should point toward stable things: features → shared, handlers → use cases →
    domain.
  - Browser code must not depend on server code (this tool refuses it); share types through
    a contract package.
  - Cycles (A → B → A) mean the boundary is wrong.
- **implements** (`implements`): An adapter realizes a port — PrismaOrderRepository implements OrderRepository. Only adapters implement ports.

  - The use case depends on the port (`uses port`); the adapter implements it. Wiring
    happens at startup.
  - Several adapters can implement one port: Postgres in production, in-memory in tests.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.

  - Run migrations in the deploy pipeline before the new code starts.
  - Make them backward compatible (expand and contract) so old and new code can run at the
    same time.
- **reads** (`reads`): Code reads data from a store. Set via (the data-access library) and, where it matters, the isolation level.

  - `via` names the library (prisma, drizzle, kysely, pg).
  - Reading another service's tables couples you to its schema; prefer its API or a
    published view.
  - Reads can go to a replica when slightly old data is fine.
- **uses port** (`uses-port`): Code depends on an interface instead of a concrete implementation, so the implementation can be swapped or faked in tests.

  - Pass the port in (constructor or function argument); do not import the adapter.
  - One port per real need; avoid one giant "Database" port.
- **writes** (`writes`): Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.

  - `concurrencyControl` documents how concurrent writers are kept apart: `none`,
    `optimistic-version`, `row-lock`, `advisory-lock`, `serializable-retry`.
  - `isolation` documents the transaction isolation level.
  - Writes that belong together go in one transaction.
