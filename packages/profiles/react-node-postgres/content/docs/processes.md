---
id: processes
kind: relation
title: processes
summary: A worker (or service) takes jobs from a Postgres job queue and runs them, with retries.
level: intermediate
tracks: [concurrency-and-parallelism]
tags: [jobs, workers]
related: [pg.job-queue, node.worker, enqueues, consumes]
references:
  - title: pg-boss — work()
    url: https://timgit.github.io/pg-boss/#/./api/jobs?id=work
---

## Beginner

`Worker processes jobs` means the worker takes jobs from the queue one by one (or several
at a time) and runs them.

## Intermediate

- Set concurrency, retries and backoff; route failed jobs to a dead-letter queue.
- Jobs must be idempotent: a crash after the work but before "done" runs them again.

## Senior

- Several workers share the queue safely with `FOR UPDATE SKIP LOCKED`.

## Common mistakes

- Non-idempotent job handlers.

## Examples

**Process with a concurrency limit:**

```ts
await boss.work('resize-image', { batchSize: 4 }, async (jobs) => {
  await Promise.all(jobs.map((j) => resize(j.data.imageId)));
});
```
