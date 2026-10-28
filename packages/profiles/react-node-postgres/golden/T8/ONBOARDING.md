# Onboarding: Transactional outbox on PostgreSQL

The service writes its data and the events about it to an outbox table in one transaction. A relay publishes the outbox rows; consumers react to them.

This guide is written for the **intermediate** level. Open the project in ArchitectureGuide to see the diagram, follow the tour, and read every concept at your level.

## The big picture

```mermaid
flowchart LR
  actor__customer(["Customer<br/><small>User / actor</small>"])
  subgraph db__orders_db["Orders DB"]
    jobs__events>"events<br/><small>Postgres job queue</small>"]
    subgraph schema__orders["orders"]
      tbl__orders["orders<br/><small>Table</small>"]
      tbl__outbox["outbox<br/><small>Table</small>"]
    end
  end
  subgraph svc__orders["Orders"]
    ctl__orders_routes("Orders routes<br/><small>Controller / route handler</small>")
    mw__auth_middleware("Auth middleware<br/><small>Middleware</small>")
    uc__change_and_record_event("Change and record event<br/><small>Use case / application service</small>")
  end
  wrk__notifications["Notifications<br/><small>Background worker</small>"]
  wrk__outbox_relay["Outbox relay<br/><small>Background worker</small>"]
  actor__customer -->|"calls"| svc__orders
  ctl__orders_routes -->|"calls"| uc__change_and_record_event
  svc__orders -->|"migrates"| schema__orders
  uc__change_and_record_event ==>|"writes"| tbl__orders
  uc__change_and_record_event ==>|"writes"| tbl__outbox
  wrk__notifications -.->|"processes"| jobs__events
  wrk__outbox_relay -.->|"enqueues: order.placed, order.paid"| jobs__events
  wrk__outbox_relay -->|"reads"| tbl__outbox
  wrk__outbox_relay ==>|"writes: mark sent"| tbl__outbox
```

## Tour of Transactional outbox on PostgreSQL

1. **One transaction**: "Change and record event" writes the Orders row and the outbox row together. Either both are committed or neither is.

   Look at: Change and record event, orders, outbox.
2. **The relay**: A separate process reads unsent rows in order, publishes them (order.placed, order.paid) and marks them sent. If it crashes in between, it sends again: consumers must be idempotent.

   Look at: Outbox relay, Notifications.

## Patterns used

### Transactional outbox

The service writes its data and the event about it to an outbox table in one transaction; a relay publishes the outbox rows afterwards, so no event is lost or invented.

- The outbox row holds the event type (topic), a payload with IDs and the facts the
  consumer needs, and a `sent_at` column.
- The relay reads unsent rows in order (`ORDER BY id`) and in small batches; with several
  relay instances use `FOR UPDATE SKIP LOCKED`.
- Delivery is **at least once**: a relay that crashes after publishing sends the event
  again. Give each event an ID and make consumers idempotent.
- If the target is a PostgreSQL job queue in the same database, the relay can enqueue
  and mark the row sent in one transaction. For an external broker (Kafka, RabbitMQ) it
  publishes first and marks after.
- Delete or archive sent rows on a schedule so the table stays small.

## Who owns which data

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.orders | svc.orders | svc.orders, wrk.outbox-relay | wrk.outbox-relay |

## Rules of the road

- Orders MUST write its data and the outbox row in one transaction; it MUST NOT publish directly.
- Only the outbox relay MAY publish the events (order.placed, order.paid); it marks rows as sent after publishing.
- Consumers MUST be idempotent: the relay delivers each event at least once.

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
- **Background worker** (`node.worker`): A Node process that runs jobs from a queue — emails, invoices, image resizing — outside the request, with retries when something fails.

  - Jobs must be **idempotent**: a job can run twice (a crash after the work, before the
    "done" mark). Sending an email twice is bad; check "already sent?" first.
  - Set **retries with backoff** and a **dead-letter** queue for jobs that keep failing.
  - `concurrency` controls how many jobs one worker runs at once; `instances` how many
    workers run.
  - Enqueue in the **same transaction** as the data (`inTransaction`), so an order never
    exists without its email job, and a rolled-back order never sends one.
- **Database** (`pg.database`): A PostgreSQL database — the place where data survives restarts. Only backend code connects to it; schemas inside it group tables by owner.

  - Use transactions for changes that belong together.
  - Run schema changes as **migrations** owned by one service.
  - Back up regularly and test restores.
  - One database can serve several services if each owns its own schema; or each service
    gets its own database (database per service).
- **Postgres job queue** (`pg.job-queue`): A durable job queue stored in Postgres tables (pg-boss, graphile-worker). Jobs can be added in the same transaction as your data, so neither is lost.

  - Workers take jobs with `SELECT … FOR UPDATE SKIP LOCKED`, so several workers never take
    the same job and never wait for each other.
  - Set retries, backoff, expiry and a dead-letter queue.
  - Jobs must be idempotent.
  - `inTransaction: true` on the `enqueues` relation documents the transactional enqueue.
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
- **enqueues** (`enqueues`): Adds a job to a Postgres job queue. Set inTransaction when the job is added in the same transaction as the data.

  - `inTransaction: true` means the job is added in the same transaction as the business
    data — both commit or neither does.
  - Pass IDs, not whole objects; the worker loads fresh data.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.

  - Run migrations in the deploy pipeline before the new code starts.
  - Make them backward compatible (expand and contract) so old and new code can run at the
    same time.
- **processes** (`processes`): A worker (or service) takes jobs from a Postgres job queue and runs them, with retries.

  - Set concurrency, retries and backoff; route failed jobs to a dead-letter queue.
  - Jobs must be idempotent: a crash after the work but before "done" runs them again.
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
