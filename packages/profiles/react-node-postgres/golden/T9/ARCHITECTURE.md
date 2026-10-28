---
archguide: 1
project: cqrs-lite
profile: react-node-postgres
patterns: [cqrs-lite]
revision: 0
generated: 2026-10-27
---

# Architecture: CQRS-lite on PostgreSQL

Commands change the write tables; a projector keeps read models (projection tables and materialized views) up to date; queries read only the read models.

## Elements

| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |
|---|---|---|---|---|---|---|---|
| actor.customer | gen.actor | Customer | – | – | – | – | – |
| ctl.commands | node.route-handler | Commands | svc.orders | application | – | – | – |
| ctl.queries | node.route-handler | Queries | svc.orders | application | – | – | – |
| mw.auth-middleware | node.middleware | Auth middleware | svc.orders | application | – | Read the session cookie; Reject calls without a valid session | – |
| svc.orders | node.service | Orders | – | application | – | – | – |
| uc.place-order | node.use-case | Place order | svc.orders | application | – | – | services/Orders/src/application/** |
| uc.read-views | node.use-case | Read views | svc.orders | application | – | – | services/Orders/src/application/** |
| wrk.projector | node.worker | Projector | – | application | – | Keep Order summary, Sales by day up to date | services/Orders/src/projector/** |
| db.orders-db | pg.database | Orders DB | – | data | – | – | – |
| jobs.changes | pg.job-queue | changes | db.orders-db | data | – | – | – |
| schema.app | pg.schema | app | db.orders-db | data | – | – | – |
| tbl.order-summary | pg.table | Order summary | schema.app | data | – | – | – |
| tbl.orders | pg.table | orders | schema.app | data | – | – | – |
| view.sales-by-day | pg.view | Sales by day | schema.app | data | – | – | – |

## Relations

| From | Relation | To | Details |
|---|---|---|---|
| actor.customer | calls | svc.orders | http |
| ctl.commands | calls | uc.place-order | – |
| ctl.queries | calls | uc.read-views | – |
| svc.orders | migrates | schema.app | – |
| uc.place-order | enqueues | jobs.changes | project, in the same transaction |
| uc.place-order | writes | tbl.orders | via prisma, in the same transaction |
| uc.read-views | reads | tbl.order-summary | via prisma |
| uc.read-views | reads | view.sales-by-day | via prisma |
| wrk.projector | processes | jobs.changes | – |
| wrk.projector | reads | tbl.orders | via pg |
| wrk.projector | writes | tbl.order-summary | via pg |

## Data ownership

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.app | svc.orders | svc.orders, wrk.projector | svc.orders, wrk.projector |

## Invariants

- Queries MUST read only the read models (Order summary, Sales by day); commands MUST write only the write tables. (T9)
- Only the projector MAY write the read models. (T9)
- Read models MAY lag behind the write tables; screens MUST NOT assume read-your-own-writes. (T9)
- Modules MUST NOT depend on each other in a cycle. (AP-003)
- Services MUST NOT call each other synchronously in a cycle. (AP-006)
- Synchronous call chains between services MUST stay at most 4 services long. (AP-007)
- Consumers MUST move messages that keep failing to a dead-letter queue. (AP-012)
- Sensitive data (PII, secrets) MUST NOT be reachable from browser code. (AP-015)
- Consumers MUST NOT call the publisher of a message back synchronously. (AP-017)
- Each PostgreSQL schema MUST have one writing service; other services use its API or events. (RNP-001)
- Each schema MUST have exactly one migration owner. (RNP-002)
- Jobs MUST be enqueued in the same transaction as their data; messages to other brokers go through an outbox. (RNP-007)
- Horizontally scaled or serverless services MUST connect to PostgreSQL through a connection pooler. (RNP-009)
- Route handlers MUST validate every request with a schema (zod or similar). (RNP-015)
- Services reachable from the browser MUST authenticate callers (auth middleware, gateway or auth provider). (RNP-016)
- Writes to rows that several writers change MUST use a row lock or an optimistic version check. (RNP-019)
- The connection pools of all services together MUST stay below 80% of max_connections, or go through a pooler. (RNP-020)
- CPU-heavy work MUST NOT run on the event loop of a request-serving process; use worker threads or a worker. (RNP-021)
- Serializable transactions MUST be retried on SQLSTATE 40001. (RNP-022)
- Only the projector MAY write a read model; commands write the write tables. (RNP-029)

## Concepts

- **User / actor** (`gen.actor`): A person or role that uses the system — customer, admin, support agent. Diagrams start with who uses the system and why.
- **Middleware** (`node.middleware`): Code that runs before (or after) every handler of a route group — authentication, rate limiting, request logging, error handling.
- **Controller / route handler** (`node.route-handler`): Code that receives an HTTP request, validates it, calls the business logic, and turns the result into an HTTP response. Thin by design.
- **Node service** (`node.service`): A Node.js process that answers requests. It checks who is calling, validates input, applies business rules, and is the only part that talks to the database.
- **Use case / application service** (`node.use-case`): One business action — PlaceOrder, RefundOrder — as one function or class. It loads data, asks the domain to apply the rules, saves, and starts follow-up work.
- **Background worker** (`node.worker`): A Node process that runs jobs from a queue — emails, invoices, image resizing — outside the request, with retries when something fails.
- **Database** (`pg.database`): A PostgreSQL database — the place where data survives restarts. Only backend code connects to it; schemas inside it group tables by owner.
- **Postgres job queue** (`pg.job-queue`): A durable job queue stored in Postgres tables (pg-boss, graphile-worker). Jobs can be added in the same transaction as your data, so neither is lost.
- **Schema** (`pg.schema`): A namespace of tables inside a database. In this tool it is also the ownership boundary — one service owns a schema and runs its migrations.
- **Table** (`pg.table`): Tables store your data; keys, constraints and indexes keep it correct and fast.
- **View / materialized view** (`pg.view`): A saved query that you read like a table. A materialized view stores its result — fast reads for reports, refreshed on a schedule.
- **calls** (`calls`): A synchronous request and response — the caller waits for the answer. Set the protocol, auth, timeout and whether it is safe to retry.
- **enqueues** (`enqueues`): Adds a job to a Postgres job queue. Set inTransaction when the job is added in the same transaction as the data.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.
- **processes** (`processes`): A worker (or service) takes jobs from a Postgres job queue and runs them, with retries.
- **reads** (`reads`): Code reads data from a store. Set via (the data-access library) and, where it matters, the isolation level.
- **writes** (`writes`): Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.
