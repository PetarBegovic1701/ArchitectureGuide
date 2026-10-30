---
id: py.worker
kind: concept
title: Python worker
summary: A Python process that runs background jobs from a queue (Celery, RQ, Dramatiq, arq), outside the request, with retries when something fails.
level: intermediate
tracks: [concurrency-and-parallelism]
tags: [python, celery, rq, dramatiq, jobs, async]
related: [node.worker, py.service, processes, enqueues, pattern.background-jobs]
references:
  - title: Celery — Introduction
    url: https://docs.celeryq.dev/en/stable/getting-started/introduction.html
  - title: RQ — Simple job queues for Python
    url: https://python-rq.org/
  - title: Dramatiq — Motivation
    url: https://dramatiq.io/motivation.html
---

## Beginner

Some work is slow or can fail: sending an email, making a report, calling a partner API.
The user should not wait for it. The API puts a job on a queue and answers at once. A
**worker**, a separate Python process, takes the jobs from the queue, runs them, and
tries again when one fails.

## Intermediate

- Jobs must be **idempotent**: a job can run twice. Check "already done?" before you
  send an email or charge a card.
- Set retries with backoff, and a place for jobs that keep failing.
- The broker (Redis, RabbitMQ, or Postgres) is a separate part of the architecture.
  Show it on the diagram, with the producers and the workers.
- Concurrency is the number of jobs one worker runs at the same time; instances are the
  number of worker processes.

## Senior

- Add the job in the same transaction as the data when the broker allows it (a Postgres
  job table), or use an outbox, so a rolled-back order never sends its email.
- Separate queues by latency class, so slow reports do not delay password-reset emails.
- Watch the queue depth and the age of the oldest job, and alert when they grow.

## Common mistakes

- Non-idempotent jobs (double charges, duplicate emails).
- Sending the job before the commit, so a failed transaction still runs the job.
- Passing whole objects to the job instead of an ID, so the job works on old data.

## Examples

**A Celery task and its producer:**

```python
@app.task(bind=True, max_retries=5)
def send_confirmation(self, order_id: int):
    if emails.already_sent(order_id):
        return  # idempotent
    mailer.send_confirmation(order_id)

# In the API, after the commit:
send_confirmation.delay(order.id)
```
