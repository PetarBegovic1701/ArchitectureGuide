---
archguide: 1
project: starter
profile: react-node-postgres
patterns: [starter]
revision: 0
generated: 2026-10-27
---

# Architecture: Starter: React + Express + PostgreSQL

A React app calls one Node.js REST API, which owns one PostgreSQL schema. The smallest complete full-stack design.

## Elements

| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |
|---|---|---|---|---|---|---|---|
| actor.customer | gen.actor | Customer | – | – | – | – | – |
| app.shop | react.app | Shop | – | presentation | – | – | apps/web/** |
| route.home | react.route | Home | app.shop | presentation | – | – | – |
| mw.auth-middleware | node.middleware | Auth middleware | svc.shop-api | application | – | Read the session cookie; Reject calls without a valid session | – |
| svc.shop-api | node.service | Shop API | – | application | – | – | apps/api/** |
| db.shop-db | pg.database | Shop DB | – | data | – | – | – |
| schema.public | pg.schema | public | db.shop-db | data | – | – | apps/api/prisma/** |

## Relations

| From | Relation | To | Details |
|---|---|---|---|
| actor.customer | calls | app.shop | uses |
| app.shop | calls | svc.shop-api | http, REST /api |
| svc.shop-api | migrates | schema.public | – |
| svc.shop-api | reads | schema.public | via prisma |
| svc.shop-api | writes | schema.public | via prisma |

## Data ownership

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.public | svc.shop-api | svc.shop-api | svc.shop-api |

## Invariants

- The Shop React app MUST NOT connect to PostgreSQL; it calls Shop API over HTTP. (T1)
- Only Shop API MAY write and migrate the "public" schema of Shop DB. (T1)
- Auth tokens MUST live in an HttpOnly cookie, not in localStorage. (T1)
- Only `svc.shop-api` MAY write `schema.public`. Only `svc.shop-api` MAY run migrations on it. (ownership)
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

- **User / actor** (`gen.actor`): A person or role that uses the system (customer, admin, support agent).
- **Middleware** (`node.middleware`): Runs before or after handlers: auth, validation, rate limiting, error handling.
- **Node service** (`node.service`): A Node.js process that serves requests (Express, Fastify or NestJS).
- **Database** (`pg.database`): A PostgreSQL database.
- **Schema** (`pg.schema`): A namespace of tables.
- **React app** (`react.app`): A React single-page app built with Vite.
- **Route / page** (`react.route`): A page reachable by URL (React Router or TanStack Router route).
- **calls** (`calls`): Synchronous request/response.
- **migrates** (`migrates`): This element owns the DDL (migrations) of the schema.
- **reads** (`reads`): Reads data from a store.
- **writes** (`writes`): Writes data to a store.
