---
id: node.event
kind: concept
title: Domain / integration event
summary: A fact that happened — OrderPlaced, PaymentFailed. The part that raises it does not know who reacts; other parts handle it in their own time.
level: intermediate
tracks: [patterns, concurrency-and-parallelism]
tags: [events, ddd, outbox, pubsub]
related: [node.module, node.domain, emits, handles, pg.job-queue]
references:
  - title: Martin Fowler — What do you mean by "event-driven"?
    url: https://martinfowler.com/articles/201701-event-driven.html
  - title: microservices.io — Transactional outbox
    url: https://microservices.io/patterns/data/transactional-outbox.html
---

## Beginner

An **event** is a short message about something that already happened: "order 42 was
placed". The orders module **emits** it; the warehouse and email modules **handle** it.

The orders module does not need to know about warehouses or emails, so you can add a new
reaction without touching it.

## Intermediate

- Name events in the past tense, with the facts handlers need (`OrderPlaced { orderId,
total }`).
- **Domain events** stay inside a service or module; **integration events** cross
  services and need a stable, versioned shape.
- Handlers must be idempotent; events can be delivered twice.

## Senior

- Publishing an event and saving data must not drift apart: use a **transactional
  outbox** (write the event in the same transaction, publish it afterwards), or a Postgres
  job queue in the same transaction.
- Events give eventual consistency; design the UI for "processing" states.
- Avoid chains of events that together implement one business process nobody can see;
  sometimes an explicit workflow is clearer.

## Common mistakes

- Publishing after the commit without an outbox (lost events) or before it (events for
  data that was rolled back).
- Events named as commands ("SendEmail").

## Examples

**Record the event in the same transaction (outbox):**

```sql
BEGIN;
INSERT INTO orders (id, user_id, total) VALUES ($1, $2, $3);
INSERT INTO outbox (topic, payload) VALUES ('OrderPlaced', jsonb_build_object('orderId', $1));
COMMIT;
```
