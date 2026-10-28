---
archguide: 1
project: hexagonal-service
profile: react-node-postgres
patterns: [hexagonal-service]
revision: 0
generated: 2026-10-27
---

# Architecture: Hexagonal Node service

The domain is in the middle and depends on nothing. Use cases call ports (interfaces); adapters implement them for HTTP and the database.

## Elements

| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |
|---|---|---|---|---|---|---|---|
| actor.api-client | gen.actor | API client | – | – | – | – | – |
| ctl.order-http-adapter | node.route-handler | Order HTTP adapter | svc.orders | application | – | – | services/orders/src/adapters/http/** |
| mw.auth-middleware | node.middleware | Auth middleware | svc.orders | application | – | Read the session cookie; Reject calls without a valid session | – |
| svc.orders | node.service | Orders | – | application | – | – | – |
| uc.place-order | node.use-case | Place order | svc.orders | application | – | – | services/orders/src/application/** |
| dom.order | node.domain | Order | svc.orders | domain | – | Keep order totals and states valid | services/orders/src/domain/** |
| port.order-repository-port | node.port | Order repository port | svc.orders | domain | – | – | services/orders/src/domain/ports/** |
| repo.order-repository-prisma | node.repository | Order repository (prisma) | svc.orders | infrastructure | – | – | services/orders/src/adapters/db/** |
| db.database | pg.database | Database | – | data | – | – | – |
| schema.orders | pg.schema | orders | db.database | data | – | – | – |
| tbl.orders | pg.table | orders | schema.orders | data | – | – | – |

## Relations

| From | Relation | To | Details |
|---|---|---|---|
| actor.api-client | calls | svc.orders | http |
| ctl.order-http-adapter | calls | uc.place-order | – |
| repo.order-repository-prisma | implements | port.order-repository-port | – |
| repo.order-repository-prisma | reads | tbl.orders | via prisma |
| repo.order-repository-prisma | writes | tbl.orders | via prisma |
| svc.orders | migrates | schema.orders | – |
| uc.place-order | depends-on | dom.order | – |
| uc.place-order | uses-port | port.order-repository-port | – |

## Data ownership

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.orders | svc.orders | svc.orders | svc.orders |

## Invariants

- `services/orders/src/domain` MUST NOT import @prisma/client, drizzle-orm, kysely, express or any adapter. (T3)
- Persistence MUST go through a node.port; node.repository implements it. (T3)
- node.route-handler MUST call a node.use-case, never a node.repository. (T3)
- Only `svc.orders` MAY write `schema.orders`. Only `svc.orders` MAY run migrations on it. (ownership)
- Modules MUST NOT depend on each other in a cycle. (AP-003)
- Services MUST NOT call each other synchronously in a cycle. (AP-006)
- Synchronous call chains between services MUST stay at most 4 services long. (AP-007)
- Sensitive data (PII, secrets) MUST NOT be reachable from browser code. (AP-015)
- Each PostgreSQL schema MUST have one writing service; other services use its API or events. (RNP-001)
- Each schema MUST have exactly one migration owner. (RNP-002)
- Route handlers MUST NOT query PostgreSQL directly; they call a use case, which uses a repository. (RNP-005)
- Domain code MUST NOT import the ORM, repositories or HTTP code; it depends on ports. (RNP-006)
- Horizontally scaled or serverless services MUST connect to PostgreSQL through a connection pooler. (RNP-009)
- Route handlers MUST validate every request with a schema (zod or similar). (RNP-015)
- Services reachable from the browser MUST authenticate callers (auth middleware, gateway or auth provider). (RNP-016)
- Writes to rows that several writers change MUST use a row lock or an optimistic version check. (RNP-019)
- The connection pools of all services together MUST stay below 80% of max_connections, or go through a pooler. (RNP-020)
- CPU-heavy work MUST NOT run on the event loop of a request-serving process; use worker threads or a worker. (RNP-021)
- Serializable transactions MUST be retried on SQLSTATE 40001. (RNP-022)

## Concepts

- **User / actor** (`gen.actor`): A person or role that uses the system — customer, admin, support agent. Diagrams start with who uses the system and why.
- **Domain model / aggregate** (`node.domain`): The business rules and state, written as plain code without database or HTTP — an Order that refuses to ship before it is paid.
- **Middleware** (`node.middleware`): Code that runs before (or after) every handler of a route group — authentication, rate limiting, request logging, error handling.
- **Port (interface)** (`node.port`): An interface the application needs — OrderRepository, PaymentGateway — written in its own terms. Adapters implement it with a real database or service.
- **Repository / data access** (`node.repository`): The code that reads and writes the database through an ORM or query builder (Prisma, Drizzle, Kysely), so the rest of the app does not write SQL.
- **Controller / route handler** (`node.route-handler`): Code that receives an HTTP request, validates it, calls the business logic, and turns the result into an HTTP response. Thin by design.
- **Node service** (`node.service`): A Node.js process that answers requests. It checks who is calling, validates input, applies business rules, and is the only part that talks to the database.
- **Use case / application service** (`node.use-case`): One business action — PlaceOrder, RefundOrder — as one function or class. It loads data, asks the domain to apply the rules, saves, and starts follow-up work.
- **Database** (`pg.database`): A PostgreSQL database — the place where data survives restarts. Only backend code connects to it; schemas inside it group tables by owner.
- **Schema** (`pg.schema`): A namespace of tables inside a database. In this tool it is also the ownership boundary — one service owns a schema and runs its migrations.
- **Table** (`pg.table`): Tables store your data; keys, constraints and indexes keep it correct and fast.
- **calls** (`calls`): A synchronous request and response — the caller waits for the answer. Set the protocol, auth, timeout and whether it is safe to retry.
- **depends on** (`depends-on`): A compile-time import — one module uses another's code. The direction of these arrows is the architecture.
- **implements** (`implements`): An adapter realizes a port — PrismaOrderRepository implements OrderRepository. Only adapters implement ports.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.
- **reads** (`reads`): Code reads data from a store. Set via (the data-access library) and, where it matters, the isolation level.
- **uses port** (`uses-port`): Code depends on an interface instead of a concrete implementation, so the implementation can be swapped or faked in tests.
- **writes** (`writes`): Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.
