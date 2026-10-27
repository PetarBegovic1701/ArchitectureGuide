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

- **User / actor** (`gen.actor`): A person or role that uses the system (customer, admin, support agent).
- **Domain model / aggregate** (`node.domain`): Business rules and state, free of frameworks and I/O.
- **Middleware** (`node.middleware`): Runs before or after handlers: auth, validation, rate limiting, error handling.
- **Port (interface)** (`node.port`): An interface the application needs (`OrderRepository`, `PaymentGateway`).
- **Repository / data access** (`node.repository`): Reads and writes the database through an ORM or query builder.
- **Controller / route handler** (`node.route-handler`): Receives HTTP requests: an Express router, Fastify routes or a NestJS controller.
- **Node service** (`node.service`): A Node.js process that serves requests (Express, Fastify or NestJS).
- **Use case / application service** (`node.use-case`): One application action (`PlaceOrder`).
- **Database** (`pg.database`): A PostgreSQL database.
- **Schema** (`pg.schema`): A namespace of tables.
- **Table** (`pg.table`): Tables store your data; keys, constraints and indexes keep it correct and fast.
- **calls** (`calls`): Synchronous request/response.
- **depends on** (`depends-on`): Compile-time import of another module or package.
- **implements** (`implements`): An adapter realizes a port (interface).
- **migrates** (`migrates`): This element owns the DDL (migrations) of the schema.
- **reads** (`reads`): Reads data from a store.
- **uses port** (`uses-port`): Depends on an interface instead of a concrete implementation.
- **writes** (`writes`): Writes data to a store.
