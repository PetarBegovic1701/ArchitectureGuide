---
archguide: 1
project: background-jobs
profile: react-node-postgres
patterns: [background-jobs]
revision: 0
generated: 2026-10-27
---

# Architecture: Background jobs on PostgreSQL

The API saves the request and enqueues a job in the same transaction. A worker process runs slow or failure-prone work, with retries.

## Elements

| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |
|---|---|---|---|---|---|---|---|
| actor.customer | gen.actor | Customer | – | – | – | – | – |
| ctl.order-routes | node.route-handler | Order routes | svc.shop-api | application | – | – | – |
| mw.auth-middleware | node.middleware | Auth middleware | svc.shop-api | application | – | Read the session cookie; Reject calls without a valid session | – |
| svc.shop-api | node.service | Shop API | – | application | – | – | – |
| uc.place-order | node.use-case | Place order | svc.shop-api | application | – | – | – |
| wrk.worker | node.worker | Worker | – | application | – | Send confirmation email; Generate invoice PDF | – |
| db.shop-db | pg.database | Shop DB | – | data | – | – | – |
| jobs.jobs | pg.job-queue | jobs | db.shop-db | data | – | – | – |
| schema.public | pg.schema | public | db.shop-db | data | – | – | – |
| ext.e-mail-provider | gen.external | E-mail provider | – | external | – | – | – |

## Relations

| From | Relation | To | Details |
|---|---|---|---|
| actor.customer | calls | svc.shop-api | http |
| ctl.order-routes | calls | uc.place-order | – |
| svc.shop-api | migrates | schema.public | – |
| uc.place-order | enqueues | jobs.jobs | in the same transaction |
| uc.place-order | writes | schema.public | via prisma |
| wrk.worker | calls | ext.e-mail-provider | http, retries: 3, timeoutMs: 10000 |
| wrk.worker | processes | jobs.jobs | – |
| wrk.worker | reads | schema.public | via prisma |

## Data ownership

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.public | svc.shop-api | svc.shop-api | wrk.worker |

## Invariants

- Jobs MUST be enqueued in the same transaction as the data they belong to. (T7)
- Job handlers MUST be idempotent: a job can run more than once. (T7)
- Jobs that keep failing MUST move to a dead-letter queue after the last retry. (T7)
- Only `svc.shop-api` MAY write `schema.public`. Only `svc.shop-api` MAY run migrations on it. (ownership)
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

## Concepts

- **User / actor** (`gen.actor`): A person or role that uses the system (customer, admin, support agent).
- **External system** (`gen.external`): A system outside your control, for example Stripe, SendGrid or a partner API.
- **Middleware** (`node.middleware`): Runs before or after handlers: auth, validation, rate limiting, error handling.
- **Controller / route handler** (`node.route-handler`): Receives HTTP requests: an Express router, Fastify routes or a NestJS controller.
- **Node service** (`node.service`): A Node.js process that serves requests (Express, Fastify or NestJS).
- **Use case / application service** (`node.use-case`): One application action (`PlaceOrder`).
- **Background worker** (`node.worker`): A Node process that runs jobs from a queue (pg-boss, graphile-worker).
- **Database** (`pg.database`): A PostgreSQL database.
- **Postgres job queue** (`pg.job-queue`): A durable job queue stored in Postgres tables (pg-boss, graphile-worker).
- **Schema** (`pg.schema`): A namespace of tables.
- **calls** (`calls`): Synchronous request/response.
- **enqueues** (`enqueues`): Adds a job to a Postgres job queue.
- **migrates** (`migrates`): This element owns the DDL (migrations) of the schema.
- **processes** (`processes`): Runs jobs from a Postgres job queue.
- **reads** (`reads`): Reads data from a store.
- **writes** (`writes`): Writes data to a store.
