---
id: pattern.background-jobs
kind: pattern
title: Background jobs on PostgreSQL
summary: The API saves data and enqueues a job in the same transaction; a separate worker process runs the slow work later, with retries.
level: beginner
tracks: [patterns, concurrency-and-parallelism]
tags: [jobs, pg-boss, graphile-worker, skip-locked, retries]
related:
  [
    pg.job-queue,
    node.worker,
    enqueues,
    processes,
    topic.transactions-and-isolation,
    topic.event-loop-and-parallelism,
    pattern.database-per-service,
  ]
references:
  - title: pg-boss
    url: https://github.com/timgit/pg-boss
  - title: Graphile Worker
    url: https://worker.graphile.org/
  - title: PostgreSQL docs — SELECT ... FOR UPDATE SKIP LOCKED
    url: https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE
  - title: microservices.io — Transactional outbox
    url: https://microservices.io/patterns/data/transactional-outbox.html
quiz:
  - question: Why enqueue the job in the same transaction as the order?
    options:
      - It is faster
      - So a rolled-back order never sends an e-mail and a committed order always gets its job
      - PostgreSQL requires it
      - So the worker can run in the same process
    answer: 1
    explanation: Data and job commit or roll back together. Enqueuing after the commit can lose the job on a crash; enqueuing before can send e-mails for orders that never existed.
  - question: A job may run twice (for example after a worker crash). What must the handler be?
    options: [Fast, Idempotent, Synchronous, Stateless]
    answer: 1
    explanation: Queues deliver at least once. Idempotent handlers give the same result when they run again, for example by recording handled job IDs.
---

## Beginner

Some work is too slow, or fails too often, to do while the user waits: sending
e-mails, building PDFs, calling a slow partner. Instead:

1. The API saves the order **and** adds a job ("send confirmation for order 42") in
   the **same database transaction**, then answers at once.
2. A separate **worker** process takes jobs from the queue and does the work.
3. If the work fails, the worker tries again later. After the last attempt, the job
   goes to a **dead-letter queue** where a person can look at it.

With PostgreSQL you do not need another system: libraries such as pg-boss and Graphile
Worker keep the queue in tables.

## Intermediate

- Workers pick jobs with `SELECT ... FOR UPDATE SKIP LOCKED`, so many workers can run
  without taking the same job.
- Set a concurrency per worker, and count it in your connection budget.
- Jobs run **at least once**: make handlers idempotent (unique keys, "already done"
  checks), and pass IDs in the payload, not whole objects that can go stale.
- Use exponential backoff for retries, and a timeout per job.
- Scheduled jobs (cron) are jobs too: the library enqueues them on a schedule.

## Senior

A Postgres-backed queue is a great default up to hundreds of jobs per second. Beyond
that, table bloat, vacuum and index churn become the limit; then move hot queues to a
broker, often via the outbox pattern. Keep the queue in the producer's database so
enqueue is transactional. For external side effects (charging a card), combine the
job with an idempotency key at the provider, so a retry after a timeout does not charge
twice.

## Analogy

A restaurant ticket rail: the waiter pins the order ticket and goes back to the guests;
the cooks take tickets one by one. Nobody stands at the stove waiting.

## Common mistakes

- Sending the e-mail inside the HTTP request.
- Enqueuing after the commit (lost jobs on a crash), or with a different database
  connection than the data (not atomic).
- Non-idempotent handlers that double-charge or double-send on retry.
- Workers doing CPU-heavy work with high concurrency in one process.

## Examples

**Enqueue in the same transaction (Graphile Worker, node-postgres):**

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const { rows } = await client.query(
    'INSERT INTO orders (customer_id, total_cents) VALUES ($1, $2) RETURNING id',
    [customerId, totalCents],
  );
  await client.query(
    "SELECT graphile_worker.add_job('send_confirmation', json_build_object('orderId', $1::bigint))",
    [rows[0].id],
  );
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

**How a worker takes one job safely:**

```sql
WITH next AS (
  SELECT id FROM jobs
  WHERE run_at <= now() AND locked_at IS NULL
  ORDER BY run_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE jobs SET locked_at = now(), attempts = attempts + 1
FROM next WHERE jobs.id = next.id
RETURNING jobs.*;
```
