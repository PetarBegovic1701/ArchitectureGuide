# Onboarding: Background jobs on PostgreSQL

The API saves the request and enqueues a job in the same transaction. A worker process runs slow or failure-prone work, with retries.

This guide is written for the **intermediate** level. Open the project in ArchitectureGuide to see the diagram, follow the tour, and read every concept at your level.

## The big picture

```mermaid
flowchart LR
  actor__customer(["Customer<br/><small>User / actor</small>"])
  subgraph db__shop_db["Shop DB"]
    jobs__jobs>"jobs<br/><small>Postgres job queue</small>"]
    schema__public[("public<br/><small>Schema</small>")]
  end
  ext__e_mail_provider("E-mail provider<br/><small>External system</small>")
  subgraph svc__shop_api["Shop API"]
    ctl__order_routes("Order routes<br/><small>Controller / route handler</small>")
    mw__auth_middleware("Auth middleware<br/><small>Middleware</small>")
    uc__place_order("Place order<br/><small>Use case / application service</small>")
  end
  wrk__worker["Worker<br/><small>Background worker</small>"]
  actor__customer -->|"calls"| svc__shop_api
  ctl__order_routes -->|"calls"| uc__place_order
  svc__shop_api -->|"migrates"| schema__public
  uc__place_order -.->|"enqueues"| jobs__jobs
  uc__place_order ==>|"writes"| schema__public
  wrk__worker -->|"calls"| ext__e_mail_provider
  wrk__worker -.->|"processes"| jobs__jobs
  wrk__worker -->|"reads"| schema__public
```

## Tour of Background jobs on PostgreSQL

1. **Answer fast**: "Place order" saves the order and enqueues the jobs in one transaction, then answers. The customer never waits for Send confirmation email, Generate invoice PDF.

   Look at: Place order, jobs.
2. **The worker**: A separate process takes jobs from the queue (pg-boss), retries failures, and moves jobs that keep failing to a dead-letter queue.

   Look at: Worker.

## Patterns used

### Background jobs on PostgreSQL

The API saves data and enqueues a job in the same transaction; a separate worker process runs the slow work later, with retries.

- Workers pick jobs with `SELECT ... FOR UPDATE SKIP LOCKED`, so many workers can run
  without taking the same job.
- Set a concurrency per worker, and count it in your connection budget.
- Jobs run **at least once**: make handlers idempotent (unique keys, "already done"
  checks), and pass IDs in the payload, not whole objects that can go stale.
- Use exponential backoff for retries, and a timeout per job.
- Scheduled jobs (cron) are jobs too: the library enqueues them on a schedule.

## Who owns which data

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.public | svc.shop-api | svc.shop-api | wrk.worker |

## Rules of the road

- Jobs MUST be enqueued in the same transaction as the data they belong to.
- Job handlers MUST be idempotent: a job can run more than once.
- Jobs that keep failing MUST move to a dead-letter queue after the last retry.
- Only `svc.shop-api` MAY write `schema.public`. Only `svc.shop-api` MAY run migrations on it.

## Concepts used in this project

- **User / actor** (`gen.actor`): A person or role that uses the system (customer, admin, support agent).
- **External system** (`gen.external`): A system outside your control, for example Stripe, SendGrid or a partner API.
- **Middleware** (`node.middleware`): Runs before or after handlers: auth, validation, rate limiting, error handling.
- **Controller / route handler** (`node.route-handler`): Receives HTTP requests: an Express router, Fastify routes or a NestJS controller.
- **Node service** (`node.service`): A Node.js process that serves requests (Express, Fastify or NestJS).
- **Use case / application service** (`node.use-case`): One application action (`PlaceOrder`).
- **Background worker** (`node.worker`): A Node process that runs jobs from a queue (pg-boss, graphile-worker).
- **Database** (`pg.database`): A PostgreSQL database.
- **Postgres job queue** (`pg.job-queue`): A durable job queue stored in Postgres tables (pg-boss, graphile-worker).
- **Schema** (`pg.schema`): A namespace of tables.
- **calls** (`calls`): Synchronous request/response.
- **enqueues** (`enqueues`): Adds a job to a Postgres job queue.
- **migrates** (`migrates`): This element owns the DDL (migrations) of the schema.
- **processes** (`processes`): Runs jobs from a Postgres job queue.
- **reads** (`reads`): Reads data from a store.
- **writes** (`writes`): Writes data to a store.
