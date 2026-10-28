---
archguide: 1
project: db-per-service
profile: react-node-postgres
patterns: [db-per-service]
revision: 0
generated: 2026-10-27
---

# Architecture: Node services, database per service

A gateway in front of independent services. Each service has its own database on a shared PostgreSQL server; slow or follow-up work goes through a job queue.

## Elements

| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |
|---|---|---|---|---|---|---|---|
| actor.client | gen.actor | Client | – | – | – | – | – |
| svc.orders-service | node.service | Orders service | – | application | – | – | – |
| svc.payments-service | node.service | Payments service | – | application | – | – | – |
| svc.shipping-service | node.service | Shipping service | – | application | – | – | – |
| auth.identity-provider | gen.auth-provider | Identity provider | – | infrastructure | – | – | – |
| gw.api-gateway | gen.gateway | API gateway | – | infrastructure | nginx | – | – |
| db.orders-db | pg.database | Orders DB | pgc.postgresql-server | data | – | – | – |
| db.payments-db | pg.database | Payments DB | pgc.postgresql-server | data | – | – | – |
| db.shipping-db | pg.database | Shipping DB | pgc.postgresql-server | data | – | – | – |
| jobs.orders-jobs | pg.job-queue | Orders jobs | db.orders-db | data | – | – | – |
| pgc.postgresql-server | pg.cluster | PostgreSQL server | – | data | – | – | – |

## Relations

| From | Relation | To | Details |
|---|---|---|---|
| actor.client | calls | gw.api-gateway | http |
| gw.api-gateway | authenticates-with | auth.identity-provider | – |
| gw.api-gateway | calls | svc.orders-service | http |
| gw.api-gateway | calls | svc.payments-service | http |
| gw.api-gateway | calls | svc.shipping-service | http |
| svc.orders-service | enqueues | jobs.orders-jobs | in the same transaction |
| svc.orders-service | migrates | db.orders-db | – |
| svc.orders-service | reads | db.orders-db | via prisma |
| svc.orders-service | writes | db.orders-db | via prisma |
| svc.payments-service | migrates | db.payments-db | – |
| svc.payments-service | processes | jobs.orders-jobs | – |
| svc.payments-service | reads | db.payments-db | via prisma |
| svc.payments-service | writes | db.payments-db | via prisma |
| svc.shipping-service | migrates | db.shipping-db | – |
| svc.shipping-service | reads | db.shipping-db | via prisma |
| svc.shipping-service | writes | db.shipping-db | via prisma |

## Data ownership

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| db.orders-db | svc.orders-service | svc.orders-service | svc.orders-service |
| db.payments-db | svc.payments-service | svc.payments-service | svc.payments-service |
| db.shipping-db | svc.shipping-service | svc.shipping-service | svc.shipping-service |

## Invariants

- Each of Orders, Payments, Shipping MUST only connect to its own database. (T6)
- Services MUST NOT call each other in a cycle; follow-up work goes through the job queue. (T6)
- All external traffic MUST pass the gateway, which checks tokens. (T6)
- Only `svc.orders-service` MAY write `db.orders-db`. Only `svc.orders-service` MAY run migrations on it. (ownership)
- Only `svc.payments-service` MAY write `db.payments-db`. Only `svc.payments-service` MAY run migrations on it. (ownership)
- Only `svc.shipping-service` MAY write `db.shipping-db`. Only `svc.shipping-service` MAY run migrations on it. (ownership)
- Services MUST NOT call each other synchronously in a cycle. (AP-006)
- Synchronous call chains between services MUST stay at most 4 services long. (AP-007)
- Consumers MUST move messages that keep failing to a dead-letter queue. (AP-012)
- Sensitive data (PII, secrets) MUST NOT be reachable from browser code. (AP-015)
- Consumers MUST NOT call the publisher of a message back synchronously. (AP-017)
- Each PostgreSQL schema MUST have one writing service; other services use its API or events. (RNP-001)
- Each schema MUST have exactly one migration owner. (RNP-002)
- Jobs MUST be enqueued in the same transaction as their data; messages to other brokers go through an outbox. (RNP-007)
- Horizontally scaled or serverless services MUST connect to PostgreSQL through a connection pooler. (RNP-009)
- Services reachable from the browser MUST authenticate callers (auth middleware, gateway or auth provider). (RNP-016)
- The connection pools of all services together MUST stay below 80% of max_connections, or go through a pooler. (RNP-020)
- CPU-heavy work MUST NOT run on the event loop of a request-serving process; use worker threads or a worker. (RNP-021)
- Serializable transactions MUST be retried on SQLSTATE 40001. (RNP-022)

## Concepts

- **User / actor** (`gen.actor`): A person or role that uses the system — customer, admin, support agent. Diagrams start with who uses the system and why.
- **Auth provider** (`gen.auth-provider`): The service that signs users in and issues identities — Auth0, Clerk, Cognito, Keycloak, or your own. Apps trust its tokens instead of storing passwords.
- **API gateway / reverse proxy** (`gen.gateway`): The single entry point for requests from outside. It routes paths to services and handles TLS, rate limits and sometimes auth.
- **Node service** (`node.service`): A Node.js process that answers requests. It checks who is calling, validates input, applies business rules, and is the only part that talks to the database.
- **Postgres server** (`pg.cluster`): One running PostgreSQL server. It holds one or more databases and has limits that every app shares — connections, memory, CPU.
- **Database** (`pg.database`): A PostgreSQL database — the place where data survives restarts. Only backend code connects to it; schemas inside it group tables by owner.
- **Postgres job queue** (`pg.job-queue`): A durable job queue stored in Postgres tables (pg-boss, graphile-worker). Jobs can be added in the same transaction as your data, so neither is lost.
- **authenticates with** (`authenticates-with`): Uses an auth provider to sign users in or to verify their tokens. Set the flow — OIDC with PKCE, passwords, passkeys, API keys — and the token type.
- **calls** (`calls`): A synchronous request and response — the caller waits for the answer. Set the protocol, auth, timeout and whether it is safe to retry.
- **enqueues** (`enqueues`): Adds a job to a Postgres job queue. Set inTransaction when the job is added in the same transaction as the data.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.
- **processes** (`processes`): A worker (or service) takes jobs from a Postgres job queue and runs them, with retries.
- **reads** (`reads`): Code reads data from a store. Set via (the data-access library) and, where it matters, the isolation level.
- **writes** (`writes`): Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.
