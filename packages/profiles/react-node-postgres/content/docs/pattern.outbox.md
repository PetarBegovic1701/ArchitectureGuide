---
id: pattern.outbox
kind: pattern
title: Transactional outbox
summary: The service writes its data and the event about it to an outbox table in one transaction; a relay publishes the outbox rows afterwards, so no event is lost or invented.
level: intermediate
tracks: [patterns, concurrency-and-parallelism]
tags: [outbox, events, dual-write, at-least-once, idempotency]
related:
  [
    pattern.background-jobs,
    pg.table,
    pg.job-queue,
    node.worker,
    gen.other-broker,
    publishes,
    topic.transactions-and-isolation,
  ]
references:
  - title: microservices.io — Transactional outbox
    url: https://microservices.io/patterns/data/transactional-outbox.html
  - title: Debezium — Outbox event router
    url: https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html
  - title: PostgreSQL docs — SELECT ... FOR UPDATE SKIP LOCKED
    url: https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE
quiz:
  - question: The order is saved, then the service crashes before it publishes "order.placed" to the broker. What does the outbox change?
    options:
      - Nothing; the event is lost
      - The event row was committed with the order, so the relay publishes it later
      - The broker rolls back the order
      - The order is deleted on restart
    answer: 1
    explanation: The outbox row is part of the same transaction as the order. If the order exists, its event exists too, and the relay sends it when it runs again.
  - question: The relay publishes an event, then crashes before it marks the row as sent. What happens?
    options:
      - The event is lost
      - The event is published again, so consumers must handle duplicates
      - The broker removes the duplicate
      - The database rolls back the publish
    answer: 1
    explanation: An outbox gives at-least-once delivery. Consumers must be idempotent, for example by remembering the event IDs they handled.
---

## Beginner

A service often has to do two things when something happens: save the change, and tell
others about it ("order placed"). If it saves and then sends, a crash in between loses
the message. If it sends and then saves, a failed save leaves a message about an order
that does not exist. This is the **dual-write problem**.

The outbox fixes it with one rule: write the message into a table, the **outbox**, in the
**same transaction** as the data. Either both are saved or neither is. A separate
**relay** reads the outbox and publishes the messages, then marks them as sent.

## Intermediate

- The outbox row holds the event type (topic), a payload with IDs and the facts the
  consumer needs, and a `sent_at` column.
- The relay reads unsent rows in order (`ORDER BY id`) and in small batches; with several
  relay instances use `FOR UPDATE SKIP LOCKED`.
- Delivery is **at least once**: a relay that crashes after publishing sends the event
  again. Give each event an ID and make consumers idempotent.
- If the target is a PostgreSQL job queue in the same database, the relay can enqueue
  and mark the row sent in one transaction. For an external broker (Kafka, RabbitMQ) it
  publishes first and marks after.
- Delete or archive sent rows on a schedule so the table stays small.

## Senior

Change data capture (Debezium reading the write-ahead log) can replace the polling relay:
lower latency, no polling load, and the order of the log is the order of commits. Polling
is simpler to run and good up to thousands of events per second. Keep event schemas
versioned, and do not leak the service's table shapes into events: an event is a
public contract. Ordering per aggregate (all events of order 42 in order) usually
matters; global ordering rarely does — partition by aggregate ID.

## Analogy

A shop writes every parcel into its outgoing-mail book in the same moment it packs the
parcel. The courier works from the book. A parcel can be sent twice if the courier
forgets to tick it off, but never lost.

## Common mistakes

- Publishing to the broker inside the database transaction (the broker does not roll back).
- A relay that marks rows sent before publishing (lost events on a crash).
- Consumers that are not idempotent.
- Putting whole database rows into the event instead of a designed payload.

## Examples

**Write the data and the event in one transaction (Prisma):**

```ts
await prisma.$transaction(async (tx) => {
  const order = await tx.order.create({ data: { customerId, totalCents } });
  await tx.outbox.create({
    data: { topic: 'order.placed', payload: { orderId: order.id, totalCents } },
  });
});
```

**The relay takes a batch safely:**

```sql
SELECT id, topic, payload FROM outbox
WHERE sent_at IS NULL
ORDER BY id
FOR UPDATE SKIP LOCKED
LIMIT 100;
```
