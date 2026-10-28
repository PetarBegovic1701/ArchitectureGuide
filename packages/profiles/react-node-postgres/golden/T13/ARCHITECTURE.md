---
archguide: 1
project: multi-tenant
profile: react-node-postgres
patterns: [multi-tenant]
revision: 0
generated: 2026-10-27
---

# Architecture: Multi-tenant SaaS

Many customers (tenants) share one deployment. Each request is tied to a tenant, and PostgreSQL keeps tenants apart: with row-level security on shared tables, or with one schema per tenant.

## Elements

| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |
|---|---|---|---|---|---|---|---|
| actor.tenant-user | gen.actor | Tenant user | – | – | – | – | – |
| ctl.project-routes | node.route-handler | Project routes | svc.saas-api | application | – | – | – |
| mw.auth-middleware | node.middleware | Auth middleware | svc.saas-api | application | – | Read the session cookie; Reject calls without a valid session | – |
| mw.tenant-resolver | node.middleware | Tenant resolver | svc.saas-api | application | – | Find the tenant of the session; SET app.tenant_id for the transaction | – |
| svc.saas-api | node.service | SaaS API | – | application | – | – | – |
| db.saas-db | pg.database | SaaS DB | – | data | – | – | – |
| schema.app | pg.schema | app | db.saas-db | data | – | Every table has tenant_id and a row-level security policy | – |
| schema.control | pg.schema | control | db.saas-db | data | – | Tenants, plans, users | – |

## Relations

| From | Relation | To | Details |
|---|---|---|---|
| actor.tenant-user | calls | svc.saas-api | https |
| ctl.project-routes | reads | schema.app | via prisma |
| ctl.project-routes | writes | schema.app | via prisma |
| mw.tenant-resolver | reads | schema.control | via prisma |
| svc.saas-api | migrates | schema.app | – |
| svc.saas-api | migrates | schema.control | – |

## Data ownership

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.app | svc.saas-api | svc.saas-api | svc.saas-api |
| schema.control | svc.saas-api | – | svc.saas-api |

## Invariants

- Every request MUST be tied to exactly one tenant before it touches data. (T13)
- Tenant data MUST be isolated by the database (row-level security or one schema per tenant), not only by WHERE clauses in code. (T13)
- Background jobs MUST carry the tenant ID and set it before they touch data. (T13)
- Only `svc.saas-api` MAY write `schema.app`. Only `svc.saas-api` MAY run migrations on it. (ownership)
- Modules MUST NOT depend on each other in a cycle. (AP-003)
- Services MUST NOT call each other synchronously in a cycle. (AP-006)
- Synchronous call chains between services MUST stay at most 4 services long. (AP-007)
- Sensitive data (PII, secrets) MUST NOT be reachable from browser code. (AP-015)
- Each PostgreSQL schema MUST have one writing service; other services use its API or events. (RNP-001)
- Each schema MUST have exactly one migration owner. (RNP-002)
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
- **Controller / route handler** (`node.route-handler`): Code that receives an HTTP request, validates it, calls the business logic, and turns the result into an HTTP response. Thin by design.
- **Node service** (`node.service`): A Node.js process that answers requests. It checks who is calling, validates input, applies business rules, and is the only part that talks to the database.
- **Database** (`pg.database`): A PostgreSQL database — the place where data survives restarts. Only backend code connects to it; schemas inside it group tables by owner.
- **Schema** (`pg.schema`): A namespace of tables inside a database. In this tool it is also the ownership boundary — one service owns a schema and runs its migrations.
- **calls** (`calls`): A synchronous request and response — the caller waits for the answer. Set the protocol, auth, timeout and whether it is safe to retry.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.
- **reads** (`reads`): Code reads data from a store. Set via (the data-access library) and, where it matters, the isolation level.
- **writes** (`writes`): Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.
