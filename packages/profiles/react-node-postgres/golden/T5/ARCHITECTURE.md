---
archguide: 1
project: bff
profile: react-node-postgres
patterns: [bff]
revision: 0
generated: 2026-10-27
---

# Architecture: React + Node backend-for-frontend

The React app talks to one Node BFF. The BFF holds the session, combines calls to the backend services, and shapes data for the screens.

## Elements

| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |
|---|---|---|---|---|---|---|---|
| actor.customer | gen.actor | Customer | – | – | – | – | – |
| app.web | react.app | Web | – | presentation | – | – | – |
| bff.web-bff | node.bff | Web BFF | – | application | – | – | – |
| mw.auth-middleware | node.middleware | Auth middleware | bff.web-bff | application | – | Read the session cookie; Reject calls without a valid session | – |
| svc.catalog-service | node.service | Catalog service | – | application | – | – | – |
| svc.orders-service | node.service | Orders service | – | application | – | – | – |
| db.services-db | pg.database | Services DB | – | data | – | – | – |
| schema.catalog | pg.schema | catalog | db.services-db | data | – | – | – |
| schema.orders | pg.schema | orders | db.services-db | data | – | – | – |

## Relations

| From | Relation | To | Details |
|---|---|---|---|
| actor.customer | calls | app.web | uses |
| app.web | calls | bff.web-bff | http, one call per screen |
| bff.web-bff | calls | svc.catalog-service | http |
| bff.web-bff | calls | svc.orders-service | http |
| svc.catalog-service | migrates | schema.catalog | – |
| svc.catalog-service | reads | schema.catalog | via prisma |
| svc.catalog-service | writes | schema.catalog | via prisma |
| svc.orders-service | migrates | schema.orders | – |
| svc.orders-service | reads | schema.orders | via prisma |
| svc.orders-service | writes | schema.orders | via prisma |

## Data ownership

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.catalog | svc.catalog-service | svc.catalog-service | svc.catalog-service |
| schema.orders | svc.orders-service | svc.orders-service | svc.orders-service |

## Invariants

- The Web app MUST call only the BFF. (T5)
- The BFF MUST NOT write any database; Orders, Catalog own their data. (T5)
- Session tokens MUST stay in the BFF; the browser gets an HttpOnly cookie. (T5)
- Only `svc.catalog-service` MAY write `schema.catalog`. Only `svc.catalog-service` MAY run migrations on it. (ownership)
- Only `svc.orders-service` MAY write `schema.orders`. Only `svc.orders-service` MAY run migrations on it. (ownership)
- Browser code MUST NOT read or write a database directly. (AP-002)
- Modules MUST NOT depend on each other in a cycle. (AP-003)
- Services MUST NOT call each other synchronously in a cycle. (AP-006)
- Synchronous call chains between services MUST stay at most 4 services long. (AP-007)
- Sensitive data (PII, secrets) MUST NOT be reachable from browser code. (AP-015)
- Each PostgreSQL schema MUST have one writing service; other services use its API or events. (RNP-001)
- Each schema MUST have exactly one migration owner. (RNP-002)
- Horizontally scaled or serverless services MUST connect to PostgreSQL through a connection pooler. (RNP-009)
- The React app MUST call at most 2 Node services directly; use a BFF beyond that. (RNP-011)
- Services reachable from the browser MUST authenticate callers (auth middleware, gateway or auth provider). (RNP-016)
- Writes to rows that several writers change MUST use a row lock or an optimistic version check. (RNP-019)
- The connection pools of all services together MUST stay below 80% of max_connections, or go through a pooler. (RNP-020)
- CPU-heavy work MUST NOT run on the event loop of a request-serving process; use worker threads or a worker. (RNP-021)
- Serializable transactions MUST be retried on SQLSTATE 40001. (RNP-022)
- Auth tokens MUST NOT be stored in localStorage or sessionStorage. (RNP-026)

## Concepts

- **User / actor** (`gen.actor`): A person or role that uses the system — customer, admin, support agent. Diagrams start with who uses the system and why.
- **Backend-for-Frontend** (`node.bff`): A small backend made for one frontend. It combines calls to other services into the shape that screen needs, and can keep tokens out of the browser.
- **Middleware** (`node.middleware`): Code that runs before (or after) every handler of a route group — authentication, rate limiting, request logging, error handling.
- **Node service** (`node.service`): A Node.js process that answers requests. It checks who is calling, validates input, applies business rules, and is the only part that talks to the database.
- **Database** (`pg.database`): A PostgreSQL database — the place where data survives restarts. Only backend code connects to it; schemas inside it group tables by owner.
- **Schema** (`pg.schema`): A namespace of tables inside a database. In this tool it is also the ownership boundary — one service owns a schema and runs its migrations.
- **React app** (`react.app`): The part of the system that runs in the browser. It draws the screens and sends requests to the backend; it never holds secrets.
- **calls** (`calls`): A synchronous request and response — the caller waits for the answer. Set the protocol, auth, timeout and whether it is safe to retry.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.
- **reads** (`reads`): Code reads data from a store. Set via (the data-access library) and, where it matters, the isolation level.
- **writes** (`writes`): Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.
