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

- **User / actor** (`gen.actor`): A person or role that uses the system — customer, admin, support agent. Diagrams start with who uses the system and why.
- **Middleware** (`node.middleware`): Code that runs before (or after) every handler of a route group — authentication, rate limiting, request logging, error handling.
- **Node service** (`node.service`): A Node.js process that answers requests. It checks who is calling, validates input, applies business rules, and is the only part that talks to the database.
- **Database** (`pg.database`): A PostgreSQL database — the place where data survives restarts. Only backend code connects to it; schemas inside it group tables by owner.
- **Schema** (`pg.schema`): A namespace of tables inside a database. In this tool it is also the ownership boundary — one service owns a schema and runs its migrations.
- **React app** (`react.app`): The part of the system that runs in the browser. It draws the screens and sends requests to the backend; it never holds secrets.
- **Route / page** (`react.route`): A screen reachable by URL. The router picks the page for the current address, so links, the back button and bookmarks work.
- **calls** (`calls`): A synchronous request and response — the caller waits for the answer. Set the protocol, auth, timeout and whether it is safe to retry.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.
- **reads** (`reads`): Code reads data from a store. Set via (the data-access library) and, where it matters, the isolation level.
- **writes** (`writes`): Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.
