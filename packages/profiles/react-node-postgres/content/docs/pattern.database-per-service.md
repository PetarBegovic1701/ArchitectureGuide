---
id: pattern.database-per-service
kind: pattern
title: Database per service
summary: Each service owns its own database and nobody else connects to it. Services share data through APIs and events, not tables.
level: intermediate
tracks: [patterns, data-and-models, operations]
tags: [microservices, gateway, eventual-consistency]
related:
  [
    node.service,
    pg.database,
    gen.gateway,
    pg.job-queue,
    topic.transactions-and-isolation,
    pattern.modular-monolith,
    pattern.background-jobs,
  ]
references:
  - title: microservices.io — Database per service
    url: https://microservices.io/patterns/data/database-per-service.html
  - title: microservices.io — API gateway
    url: https://microservices.io/patterns/apigateway.html
  - title: Martin Fowler — Microservices
    url: https://martinfowler.com/articles/microservices.html
quiz:
  - question: Orders needs the customer's name to show it on an order. Which choice keeps the services independent?
    options:
      - Join the customers table from the Orders database
      - Copy the name into Orders when a customer.updated event arrives, or ask the Customers API
      - Give Orders read access to the Customers database
      - Move the customers table into the Orders database
    answer: 1
    explanation: Services keep their own copy of the data they need (updated by events) or ask the owner's API. Direct access to another database couples them again.
---

## Beginner

In a microservice design, each service is a separate program that a team can change
and deploy on its own. That only works if services do not share tables. So each
service gets **its own database**:

- Orders writes only the Orders database; Payments only the Payments database.
- If Payments needs to know about an order, it asks the Orders API or listens for an
  event.
- A **gateway** in front checks tokens and routes requests to the right service.

## Intermediate

- "Own database" can be a separate database on a shared PostgreSQL server: cheap to
  run, still separate. Use a separate database role per service, so access is enforced.
- No cross-service transactions. Use a job or event enqueued in the **same
  transaction** as the data, and make consumers idempotent.
- Avoid chains of synchronous calls (A → B → C → D): each hop adds latency and a way to
  fail. Prefer events for follow-up work.
- Count connections: every instance of every service has a pool. Add PgBouncer before
  you hit `max_connections`.

## Senior

You trade joins and ACID transactions for independent deploys. Queries that span
services become read models built from events (CQRS) or API composition in a BFF.
Consistency becomes eventual and needs design: idempotency keys, outbox, sagas with
compensations, and reconciliation jobs. If most features touch several services, the
boundaries are wrong; a modular monolith is the better start.

## Analogy

Separate shops in a mall. Each has its own stockroom; if one shop needs something from
another, it asks at the counter instead of walking into the other stockroom.

## Common mistakes

- "Microservices" that all connect to one database: a distributed monolith.
- Synchronous call cycles between services.
- Publishing events after the commit, outside the transaction (lost events).

## Examples

**An idempotent job handler (the job may run twice):**

```sql
-- Payments service, inside the job's transaction
INSERT INTO processed_jobs (job_id) VALUES ($1)
ON CONFLICT (job_id) DO NOTHING
RETURNING job_id;
-- No row returned: the job was handled before. Commit and stop.
-- A row returned: do the work in the same transaction, then commit.
```
