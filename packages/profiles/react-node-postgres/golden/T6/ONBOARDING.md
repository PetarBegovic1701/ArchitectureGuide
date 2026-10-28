# Onboarding: Node services, database per service

A gateway in front of independent services. Each service has its own database on a shared PostgreSQL server; slow or follow-up work goes through a job queue.

This guide is written for the **intermediate** level. Open the project in ArchitectureGuide to see the diagram, follow the tour, and read every concept at your level.

## The big picture

```mermaid
flowchart LR
  actor__client(["Client<br/><small>User / actor</small>"])
  auth__identity_provider{{"Identity provider<br/><small>Auth provider</small>"}}
  gw__api_gateway{"API gateway<br/><small>API gateway / reverse proxy</small>"}
  subgraph pgc__postgresql_server["PostgreSQL server"]
    subgraph db__orders_db["Orders DB"]
      jobs__orders_jobs>"Orders jobs<br/><small>Postgres job queue</small>"]
    end
    db__payments_db[("Payments DB<br/><small>Database</small>")]
    db__shipping_db[("Shipping DB<br/><small>Database</small>")]
  end
  svc__orders_service["Orders service<br/><small>Node service</small>"]
  svc__payments_service["Payments service<br/><small>Node service</small>"]
  svc__shipping_service["Shipping service<br/><small>Node service</small>"]
  actor__client -->|"calls"| gw__api_gateway
  gw__api_gateway -->|"authenticates with"| auth__identity_provider
  gw__api_gateway -->|"calls"| svc__orders_service
  gw__api_gateway -->|"calls"| svc__payments_service
  gw__api_gateway -->|"calls"| svc__shipping_service
  svc__orders_service -.->|"enqueues"| jobs__orders_jobs
  svc__orders_service -->|"migrates"| db__orders_db
  svc__orders_service -->|"reads"| db__orders_db
  svc__orders_service ==>|"writes"| db__orders_db
  svc__payments_service -->|"migrates"| db__payments_db
  svc__payments_service -.->|"processes"| jobs__orders_jobs
  svc__payments_service -->|"reads"| db__payments_db
  svc__payments_service ==>|"writes"| db__payments_db
  svc__shipping_service -->|"migrates"| db__shipping_db
  svc__shipping_service -->|"reads"| db__shipping_db
  svc__shipping_service ==>|"writes"| db__shipping_db
```

## Tour of Node services, database per service

1. **The gateway**: All traffic enters through the gateway, which checks tokens with the identity provider and routes to the services.

   Look at: API gateway, Identity provider.
2. **A database per service**: Each service has its own database on one PostgreSQL server. Nobody else connects to it.

   Look at: PostgreSQL server.
3. **Work between services**: Instead of calling the next service and waiting, the first service enqueues a job in the same transaction as its data. The other service processes it.

   Look at: Orders jobs.

## Patterns used

### Database per service

Each service owns its own database and nobody else connects to it. Services share data through APIs and events, not tables.

- "Own database" can be a separate database on a shared PostgreSQL server: cheap to
  run, still separate. Use a separate database role per service, so access is enforced.
- No cross-service transactions. Use a job or event enqueued in the **same
  transaction** as the data, and make consumers idempotent.
- Avoid chains of synchronous calls (A → B → C → D): each hop adds latency and a way to
  fail. Prefer events for follow-up work.
- Count connections: every instance of every service has a pool. Add PgBouncer before
  you hit `max_connections`.

## Who owns which data

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| db.orders-db | svc.orders-service | svc.orders-service | svc.orders-service |
| db.payments-db | svc.payments-service | svc.payments-service | svc.payments-service |
| db.shipping-db | svc.shipping-service | svc.shipping-service | svc.shipping-service |

## Rules of the road

- Each of Orders, Payments, Shipping MUST only connect to its own database.
- Services MUST NOT call each other in a cycle; follow-up work goes through the job queue.
- All external traffic MUST pass the gateway, which checks tokens.
- Only `svc.orders-service` MAY write `db.orders-db`. Only `svc.orders-service` MAY run migrations on it.
- Only `svc.payments-service` MAY write `db.payments-db`. Only `svc.payments-service` MAY run migrations on it.
- Only `svc.shipping-service` MAY write `db.shipping-db`. Only `svc.shipping-service` MAY run migrations on it.

## Concepts used in this project

- **User / actor** (`gen.actor`): A person or role that uses the system — customer, admin, support agent. Diagrams start with who uses the system and why.

  - Name actors by role, not by person ("Support agent", not "Anna").
  - Actors call **apps**, not databases. If an actor talks to an external tool (a payment
    page), draw that too.
  - Roles on actors map to roles in authorization (RBAC).
- **Auth provider** (`gen.auth-provider`): The service that signs users in and issues identities — Auth0, Clerk, Cognito, Keycloak, or your own. Apps trust its tokens instead of storing passwords.

  - Browser apps use the **authorization code flow with PKCE**; ideally a BFF runs it and
    keeps tokens server-side.
  - The API verifies tokens (signature, issuer, audience, expiry) in auth middleware.
  - The provider says **who** the user is; your app still decides **what** they may do
    (roles, ownership).
- **API gateway / reverse proxy** (`gen.gateway`): The single entry point for requests from outside. It routes paths to services and handles TLS, rate limits and sometimes auth.

  - Common jobs: TLS termination, routing, compression, request size limits, rate limits,
    CORS, access logs.
  - Cloud gateways can also check API keys or JWTs before requests reach your services.
  - Keep business logic out of the gateway.
- **Node service** (`node.service`): A Node.js process that answers requests. It checks who is calling, validates input, applies business rules, and is the only part that talks to the database.

  - Inside a service you usually find **route handlers** (HTTP in and out), **use cases**
    (one business action each) and **repositories** (database access).
  - Configure it with environment variables; keep secrets out of the code.
  - Run several **instances** behind a load balancer for availability; each has its own
    database **connection pool**.
  - Return clear errors: 400 for bad input, 401/403 for auth, 404, 409 for conflicts.
- **Postgres server** (`pg.cluster`): One running PostgreSQL server. It holds one or more databases and has limits that every app shares — connections, memory, CPU.

  - Managed hosting (RDS, Cloud SQL, Neon, Supabase) handles backups, upgrades and
    failover; you still own schema design and queries.
  - `max_connections` is a hard limit for all apps together; each Node instance's pool
    counts against it.
  - A primary server takes writes; **read replicas** can serve read-only queries.
- **Database** (`pg.database`): A PostgreSQL database — the place where data survives restarts. Only backend code connects to it; schemas inside it group tables by owner.

  - Use transactions for changes that belong together.
  - Run schema changes as **migrations** owned by one service.
  - Back up regularly and test restores.
  - One database can serve several services if each owns its own schema; or each service
    gets its own database (database per service).
- **Postgres job queue** (`pg.job-queue`): A durable job queue stored in Postgres tables (pg-boss, graphile-worker). Jobs can be added in the same transaction as your data, so neither is lost.

  - Workers take jobs with `SELECT … FOR UPDATE SKIP LOCKED`, so several workers never take
    the same job and never wait for each other.
  - Set retries, backoff, expiry and a dead-letter queue.
  - Jobs must be idempotent.
  - `inTransaction: true` on the `enqueues` relation documents the transactional enqueue.
- **authenticates with** (`authenticates-with`): Uses an auth provider to sign users in or to verify their tokens. Set the method — OIDC with PKCE, passwords, passkeys, API keys.

  - `method`: `oidc-code-pkce` for browser apps, `password`, `magic-link`, `passkey`,
    `oauth-client-credentials` for machine clients, `api-key`.
  - Authentication says who; authorization (roles, ownership) is still your code's job.
- **calls** (`calls`): A synchronous request and response — the caller waits for the answer. Set the protocol, auth, timeout and whether it is safe to retry.

  - Properties on the arrow document the decisions: `protocol` (http, graphql, trpc),
    `auth` (session cookie, bearer token, API key), `timeoutMs`, `idempotent`,
    `idempotencyKey`.
  - Every call needs a timeout.
  - Retry only idempotent calls, or send an idempotency key.
- **enqueues** (`enqueues`): Adds a job to a Postgres job queue. Set inTransaction when the job is added in the same transaction as the data.

  - `inTransaction: true` means the job is added in the same transaction as the business
    data — both commit or neither does.
  - Pass IDs, not whole objects; the worker loads fresh data.
- **migrates** (`migrates`): This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.

  - Run migrations in the deploy pipeline before the new code starts.
  - Make them backward compatible (expand and contract) so old and new code can run at the
    same time.
- **processes** (`processes`): A worker (or service) takes jobs from a Postgres job queue and runs them, with retries.

  - Set concurrency, retries and backoff; route failed jobs to a dead-letter queue.
  - Jobs must be idempotent: a crash after the work but before "done" runs them again.
- **reads** (`reads`): Code reads data from a store. Set via (the data-access library) and, where it matters, the isolation level.

  - `via` names the library (prisma, drizzle, kysely, pg).
  - Reading another service's tables couples you to its schema; prefer its API or a
    published view.
  - Reads can go to a replica when slightly old data is fine.
- **writes** (`writes`): Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.

  - `concurrencyControl` documents how concurrent writers are kept apart: `none`,
    `optimistic-version`, `row-lock`, `advisory-lock`, `serializable-retry`.
  - `isolation` documents the transaction isolation level.
  - Writes that belong together go in one transaction.
