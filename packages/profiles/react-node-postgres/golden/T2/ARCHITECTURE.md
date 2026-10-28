---
archguide: 1
project: layered-api
profile: react-node-postgres
patterns: [layered-api]
revision: 0
generated: 2026-10-27
---

# Architecture: Layered Node API

Each entity gets a route handler, a use case and a repository. Requests go down the layers, never around them.

## Elements

| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |
|---|---|---|---|---|---|---|---|
| actor.api-client | gen.actor | API client | – | – | – | – | – |
| ctl.customer-routes | node.route-handler | Customer routes | svc.orders-api | presentation | – | – | src/http/** |
| ctl.order-routes | node.route-handler | Order routes | svc.orders-api | presentation | – | – | src/http/** |
| mw.auth-middleware | node.middleware | Auth middleware | svc.orders-api | application | – | Read the session cookie; Reject calls without a valid session | – |
| svc.orders-api | node.service | Orders API | – | application | – | – | – |
| uc.customer-service | node.use-case | Customer service | svc.orders-api | application | – | – | src/application/** |
| uc.order-service | node.use-case | Order service | svc.orders-api | application | – | – | src/application/** |
| repo.customer-repository | node.repository | Customer repository | svc.orders-api | infrastructure | – | – | src/repositories/** |
| repo.order-repository | node.repository | Order repository | svc.orders-api | infrastructure | – | – | src/repositories/** |
| db.database | pg.database | Database | – | data | – | – | – |
| schema.app | pg.schema | app | db.database | data | – | – | – |
| tbl.customers | pg.table | customers | schema.app | data | – | – | – |
| tbl.orders | pg.table | orders | schema.app | data | – | – | – |

## Relations

| From | Relation | To | Details |
|---|---|---|---|
| actor.api-client | calls | svc.orders-api | http |
| ctl.customer-routes | calls | uc.customer-service | – |
| ctl.order-routes | calls | uc.order-service | – |
| repo.customer-repository | reads | tbl.customers | via prisma |
| repo.customer-repository | writes | tbl.customers | via prisma |
| repo.order-repository | reads | tbl.orders | via prisma |
| repo.order-repository | writes | tbl.orders | via prisma |
| svc.orders-api | migrates | schema.app | – |
| uc.customer-service | calls | repo.customer-repository | – |
| uc.order-service | calls | repo.order-repository | – |

## Data ownership

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.app | svc.orders-api | svc.orders-api | svc.orders-api |

## Invariants

- A node.route-handler in Orders API MUST call a node.use-case, never a repository or the database. (T2)
- Only node.repository code MAY import the database client. (T2)
- Each of Order, Customer has exactly one repository. (T2)
- Only `svc.orders-api` MAY write `schema.app`. Only `svc.orders-api` MAY run migrations on it. (ownership)
- Modules MUST NOT depend on each other in a cycle. (AP-003)
- Presentation code MUST NOT reach the data or infrastructure layer without the application layer. (AP-005)
- Services MUST NOT call each other synchronously in a cycle. (AP-006)
- Synchronous call chains between services MUST stay at most 4 services long. (AP-007)
- Sensitive data (PII, secrets) MUST NOT be reachable from browser code. (AP-015)
- Each PostgreSQL schema MUST have one writing service; other services use its API or events. (RNP-001)
- Each schema MUST have exactly one migration owner. (RNP-002)
- Route handlers MUST NOT query PostgreSQL directly; they call a use case, which uses a repository. (RNP-005)
- Horizontally scaled or serverless services MUST connect to PostgreSQL through a connection pooler. (RNP-009)
- Route handlers MUST validate every request with a schema (zod or similar). (RNP-015)
- Services reachable from the browser MUST authenticate callers (auth middleware, gateway or auth provider). (RNP-016)
- Writes to rows that several writers change MUST use a row lock or an optimistic version check. (RNP-019)
- The connection pools of all services together MUST stay below 80% of max_connections, or go through a pooler. (RNP-020)
- CPU-heavy work MUST NOT run on the event loop of a request-serving process; use worker threads or a worker. (RNP-021)
- Serializable transactions MUST be retried on SQLSTATE 40001. (RNP-022)

## Concepts

- **User / actor** (`gen.actor`): A person or role that uses the system — customer, admin, support agent. Diagrams start with who uses the system and why.
- **Middleware** (`node.middleware`): Code that runs before (or after) every handler of a route group — authentication, rate limiting, request logging, error handling.
- **Repository / data access** (`node.repository`): The code that reads and writes the database through an ORM or query builder (Prisma, Drizzle, Kysely), so the rest of the app does not write SQL.
- **Controller / route handler** (`node.route-handler`): Code that receives an HTTP request, validates it, calls the business logic, and turns the result into an HTTP response. Thin by design.
- **Node service** (`node.service`): A Node.js process that answers requests. It checks who is calling, validates input, applies business rules, and is the only part that talks to the database.
- **Use case / application service** (`node.use-case`): One business action — PlaceOrder, RefundOrder — as one function or class. It loads data, asks the domain to apply the rules, saves, and starts follow-up work.
- **Database** (`pg.database`): A PostgreSQL database — the place where data survives restarts. Only backend code connects to it; schemas inside it group tables by owner.
- **Schema** (`pg.schema`): A namespace of tables inside a database. In this tool it is also the ownership boundary — one service owns a schema and runs its migrations.
- **Table** (`pg.table`): Tables store your data; keys, constraints and indexes keep it correct and fast.
- **calls** (`calls`): A synchronous request and response — the caller waits for the answer. Set the protocol, auth, timeout and whether it is safe to retry.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.
- **reads** (`reads`): Code reads data from a store. Set via (the data-access library) and, where it matters, the isolation level.
- **writes** (`writes`): Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.
