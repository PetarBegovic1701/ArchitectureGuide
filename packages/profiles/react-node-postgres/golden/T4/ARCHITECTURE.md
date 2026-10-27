---
archguide: 1
project: modular-monolith
profile: react-node-postgres
patterns: [modular-monolith]
revision: 0
generated: 2026-10-27
---

# Architecture: NestJS modular monolith

One deployable split into modules. Each module owns its own schema and offers a public API; other modules never touch its tables.

## Elements

| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |
|---|---|---|---|---|---|---|---|
| actor.api-client | gen.actor | API client | – | – | – | – | – |
| mod.billing | node.module | Billing | svc.shop | application | – | – | src/modules/** |
| mod.catalog | node.module | Catalog | svc.shop | application | – | – | src/modules/** |
| mod.orders | node.module | Orders | svc.shop | application | – | – | src/modules/** |
| mw.auth-middleware | node.middleware | Auth middleware | svc.shop | application | – | Read the session cookie; Reject calls without a valid session | – |
| svc.shop | node.service | Shop | – | application | – | – | – |
| db.shop-db | pg.database | Shop DB | – | data | – | – | – |
| schema.billing | pg.schema | billing | db.shop-db | data | – | – | – |
| schema.catalog | pg.schema | catalog | db.shop-db | data | – | – | – |
| schema.orders | pg.schema | orders | db.shop-db | data | – | – | – |

## Relations

| From | Relation | To | Details |
|---|---|---|---|
| actor.api-client | calls | svc.shop | http |
| mod.billing | depends-on | mod.orders | public API |
| mod.billing | writes | schema.billing | via prisma |
| mod.catalog | writes | schema.catalog | via prisma |
| mod.orders | depends-on | mod.catalog | public API |
| mod.orders | writes | schema.orders | via prisma |
| svc.shop | migrates | schema.billing | – |
| svc.shop | migrates | schema.catalog | – |
| svc.shop | migrates | schema.orders | – |

## Data ownership

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.billing | svc.shop, module Billing | svc.shop | – |
| schema.catalog | svc.shop, module Catalog | svc.shop | – |
| schema.orders | svc.shop, module Orders | svc.shop | – |

## Invariants

- Each of Orders, Catalog, Billing MUST only write its own schema. (T4)
- A module MUST use another module only through its exported service, never its repositories or tables. (T4)
- Only `svc.shop` MAY write `schema.billing`. Only `svc.shop` MAY run migrations on it. (ownership)
- Only `svc.shop` MAY write `schema.catalog`. Only `svc.shop` MAY run migrations on it. (ownership)
- Only `svc.shop` MAY write `schema.orders`. Only `svc.shop` MAY run migrations on it. (ownership)
- Modules MUST NOT depend on each other in a cycle. (AP-003)
- Services MUST NOT call each other synchronously in a cycle. (AP-006)
- Synchronous call chains between services MUST stay at most 4 services long. (AP-007)
- Sensitive data (PII, secrets) MUST NOT be reachable from browser code. (AP-015)
- Each PostgreSQL schema MUST have one writing service; other services use its API or events. (RNP-001)
- Each schema MUST have exactly one migration owner. (RNP-002)
- Horizontally scaled or serverless services MUST connect to PostgreSQL through a connection pooler. (RNP-009)
- Services reachable from the browser MUST authenticate callers (auth middleware, gateway or auth provider). (RNP-016)
- Writes to rows that several writers change MUST use a row lock or an optimistic version check. (RNP-019)
- The connection pools of all services together MUST stay below 80% of max_connections, or go through a pooler. (RNP-020)
- CPU-heavy work MUST NOT run on the event loop of a request-serving process; use worker threads or a worker. (RNP-021)
- Serializable transactions MUST be retried on SQLSTATE 40001. (RNP-022)
- A module MUST only write its own schema; it uses other modules through their public services. (RNP-028)

## Concepts

- **User / actor** (`gen.actor`): A person or role that uses the system (customer, admin, support agent).
- **Middleware** (`node.middleware`): Runs before or after handlers: auth, validation, rate limiting, error handling.
- **Module** (`node.module`): A NestJS module or a feature folder with a public API.
- **Node service** (`node.service`): A Node.js process that serves requests (Express, Fastify or NestJS).
- **Database** (`pg.database`): A PostgreSQL database.
- **Schema** (`pg.schema`): A namespace of tables.
- **calls** (`calls`): Synchronous request/response.
- **depends on** (`depends-on`): Compile-time import of another module or package.
- **migrates** (`migrates`): This element owns the DDL (migrations) of the schema.
- **writes** (`writes`): Writes data to a store.
