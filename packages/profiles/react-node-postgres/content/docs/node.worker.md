---
id: node.worker
kind: concept
title: Background worker
summary: A Node process that runs jobs from a queue — emails, invoices, image resizing — outside the request, with retries when something fails.
level: intermediate
tracks: [concurrency-and-parallelism]
tags: [pg-boss, graphile-worker, jobs, async]
related:
  [pg.job-queue, processes, enqueues, pattern.background-jobs, topic.event-loop-and-parallelism]
references:
  - title: pg-boss — README
    url: https://github.com/timgit/pg-boss
  - title: Graphile Worker — Introduction
    url: https://worker.graphile.org/docs
---

## Beginner

Some work is slow or can fail for reasons outside your control: sending an email, making
a PDF invoice, calling a shipping API. The user should not wait for it.

The API **enqueues** a job ("send confirmation for order 42") and answers right away. A
**worker**, a separate Node process, **processes** jobs from the queue one by one and
retries the ones that fail.

## Intermediate

- Jobs must be **idempotent**: a job can run twice (a crash after the work, before the
  "done" mark). Sending an email twice is bad; check "already sent?" first.
- Set **retries with backoff** and a **dead-letter** queue for jobs that keep failing.
- `concurrency` controls how many jobs one worker runs at once; `instances` how many
  workers run.
- Enqueue in the **same transaction** as the data (`inTransaction`), so an order never
  exists without its email job, and a rolled-back order never sends one.

## Senior

- With a Postgres job queue, `SELECT … FOR UPDATE SKIP LOCKED` lets many workers take
  jobs without blocking each other.
- Separate queues by latency class (emails vs reports) so a slow job type does not starve
  fast ones.
- Observe queue depth and age of the oldest job; alert when they grow.
- CPU-heavy jobs still block the worker's event loop; use worker threads inside the worker
  or a dedicated process.

## Common mistakes

- Non-idempotent jobs (double charges, duplicate emails).
- Enqueuing after the commit, so a crash loses the job.
- No dead-letter handling: failing jobs retry forever.

## Examples

**Enqueue in the transaction, process in a worker (pg-boss):**

```ts
// API: in the same transaction as the order
await boss.send('send-confirmation', { orderId }, { db: tx });

// Worker
await boss.work('send-confirmation', async ([job]) => {
  if (await emails.alreadySent(job.data.orderId)) return; // idempotent
  await mailer.sendConfirmation(job.data.orderId);
});
```
