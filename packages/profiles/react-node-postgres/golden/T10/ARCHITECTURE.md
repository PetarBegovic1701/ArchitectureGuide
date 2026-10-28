---
archguide: 1
project: realtime
profile: react-node-postgres
patterns: [realtime]
revision: 0
generated: 2026-10-27
---

# Architecture: Realtime updates

The browser keeps a WebSocket open to a realtime gateway. Services signal changes with PostgreSQL NOTIFY; the gateway pushes them to the clients. Durable work still goes through a job queue.

## Elements

| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |
|---|---|---|---|---|---|---|---|
| actor.customer | gen.actor | Customer | – | – | – | – | – |
| apic.api-client | react.api-client | API client | app.web | presentation | – | – | – |
| app.web | react.app | Web | – | presentation | – | – | – |
| qcache.server-state-cache | react.server-state | Server-state cache | app.web | presentation | – | – | – |
| route.order-status | react.route | Order status | app.web | presentation | – | – | – |
| ctl.order-routes | node.route-handler | Order routes | svc.orders-api | application | – | – | – |
| mw.auth-middleware | node.middleware | Auth middleware | svc.orders-api | application | – | Read the session cookie; Reject calls without a valid session | – |
| svc.orders-api | node.service | Orders API | – | application | – | – | – |
| wrk.worker | node.worker | Worker | – | application | – | – | – |
| ws.realtime-gateway | node.ws-gateway | Realtime gateway | – | application | – | Authenticate socket connections; Push change signals to rooms | – |
| chan.order-changed | pg.channel | order_changed | db.shop-db | data | – | – | – |
| db.shop-db | pg.database | Shop DB | – | data | – | – | – |
| jobs.jobs | pg.job-queue | jobs | db.shop-db | data | – | – | – |
| schema.public | pg.schema | public | db.shop-db | data | – | – | – |

## Relations

| From | Relation | To | Details |
|---|---|---|---|
| actor.customer | calls | app.web | https |
| apic.api-client | calls | svc.orders-api | https |
| app.web | calls | ws.realtime-gateway | websocket, subscribe, auth: session-cookie |
| ctl.order-routes | enqueues | jobs.jobs | in the same transaction |
| ctl.order-routes | notifies | chan.order-changed | in the same transaction |
| ctl.order-routes | writes | schema.public | via prisma, in the same transaction |
| qcache.server-state-cache | fetches-via | apic.api-client | – |
| route.order-status | uses-state | qcache.server-state-cache | – |
| svc.orders-api | migrates | schema.public | – |
| wrk.worker | processes | jobs.jobs | – |
| ws.realtime-gateway | listens | chan.order-changed | – |

## Data ownership

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.public | svc.orders-api | svc.orders-api | – |

## Invariants

- NOTIFY messages MUST only signal that something changed; clients MUST reload the data through the API. (T10)
- Work that must not be lost MUST go through the job queue, not NOTIFY. (T10)
- The realtime gateway MUST authenticate every connection. (T10)
- Only `svc.orders-api` MAY write `schema.public`. Only `svc.orders-api` MAY run migrations on it. (ownership)
- Browser code MUST NOT read or write a database directly. (AP-002)
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
- Work that must happen MUST go through a job queue, not LISTEN/NOTIFY. (RNP-010)
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
- **Middleware** (`node.middleware`): Code that runs before (or after) every handler of a route group — authentication, rate limiting, request logging, error handling.
- **Controller / route handler** (`node.route-handler`): Code that receives an HTTP request, validates it, calls the business logic, and turns the result into an HTTP response. Thin by design.
- **Node service** (`node.service`): A Node.js process that answers requests. It checks who is calling, validates input, applies business rules, and is the only part that talks to the database.
- **Background worker** (`node.worker`): A Node process that runs jobs from a queue — emails, invoices, image resizing — outside the request, with retries when something fails.
- **Realtime gateway** (`node.ws-gateway`): Keeps open connections to browsers and pushes updates — "your order shipped", live stock — instead of making the browser ask again and again.
- **LISTEN/NOTIFY channel** (`pg.channel`): A Postgres message channel. Fast and simple for "something changed" signals, but not durable — listeners that are not connected miss messages.
- **Database** (`pg.database`): A PostgreSQL database — the place where data survives restarts. Only backend code connects to it; schemas inside it group tables by owner.
- **Postgres job queue** (`pg.job-queue`): A durable job queue stored in Postgres tables (pg-boss, graphile-worker). Jobs can be added in the same transaction as your data, so neither is lost.
- **Schema** (`pg.schema`): A namespace of tables inside a database. In this tool it is also the ownership boundary — one service owns a schema and runs its migrations.
- **API client** (`react.api-client`): The one place in the frontend that talks HTTP to the backend — base URL, auth, error handling, and request and response types.
- **React app** (`react.app`): The part of the system that runs in the browser. It draws the screens and sends requests to the backend; it never holds secrets.
- **Route / page** (`react.route`): A screen reachable by URL. The router picks the page for the current address, so links, the back button and bookmarks work.
- **Server-state cache** (`react.server-state`): Data that belongs to the server (orders, users) needs caching and refetching; data that belongs to the UI (open dialogs, drafts) needs a simple store. Mixing them causes stale screens.
- **calls** (`calls`): A synchronous request and response — the caller waits for the answer. Set the protocol, auth, timeout and whether it is safe to retry.
- **enqueues** (`enqueues`): Adds a job to a Postgres job queue. Set inTransaction when the job is added in the same transaction as the data.
- **fetches via** (`fetches-via`): React code loads data through the API client — a query, a thunk or an effect calls the backend.
- **listens** (`listens`): Runs LISTEN on a channel and receives its notifications while connected.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.
- **notifies** (`notifies`): Sends NOTIFY on a LISTEN/NOTIFY channel — a fast signal that is lost if nobody is listening.
- **processes** (`processes`): A worker (or service) takes jobs from a Postgres job queue and runs them, with retries.
- **uses state** (`uses-state`): React code reads or updates a client store or a server-state cache — a component reads the cart with a selector, a page reads orders from the query cache.
- **writes** (`writes`): Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.
