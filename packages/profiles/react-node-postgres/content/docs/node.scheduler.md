---
id: node.scheduler
kind: concept
title: Scheduled job
summary: Work that runs on a schedule — nightly clean-ups, reminders, reports — by cron syntax, ideally through the job queue so it runs once even with many instances.
level: intermediate
tracks: [concurrency-and-parallelism]
tags: [cron, pg-boss, schedule]
related: [node.worker, pg.job-queue, enqueues]
references:
  - title: pg-boss — Scheduling
    url: https://timgit.github.io/pg-boss/#/./api/scheduling
  - title: crontab.guru — cron expressions
    url: https://crontab.guru/
---

## Beginner

Some work happens at fixed times, not because a user clicked something: "every night at
02:00, delete carts older than 30 days", "every Monday, email the sales report".

A **scheduled job** describes when to run (a cron expression like `0 2 * * *`) and what
to run.

## Intermediate

- With several API instances, an in-process timer (`node-cron`) runs once **per
  instance**. Use a scheduler that coordinates through the database (pg-boss schedules,
  `pg_cron`) so the job runs once.
- Let the schedule only **enqueue** a job; a worker runs it with retries.
- Make it idempotent and safe to run late: "delete carts older than 30 days", not
  "delete yesterday's carts".

## Senior

- Time zones and daylight saving: schedule in UTC or state the time zone explicitly.
- Long jobs should process in batches and record progress, so a restart continues.
- Monitor "last successful run" and alert when it is too old.

## Common mistakes

- `setInterval` in the API, running on every instance.
- Jobs that assume they run exactly on time.

## Examples

**A nightly clean-up with pg-boss:**

```ts
await boss.schedule('purge-carts', '0 2 * * *', {}, { tz: 'UTC' });
await boss.work('purge-carts', async () => {
  await db.query(`DELETE FROM carts WHERE updated_at < now() - interval '30 days'`);
});
```
