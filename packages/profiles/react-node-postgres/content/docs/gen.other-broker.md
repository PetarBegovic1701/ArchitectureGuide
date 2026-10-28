---
id: gen.other-broker
kind: concept
title: Other message broker
summary: A broker outside this profile — Kafka, RabbitMQ, SQS. Producers publish messages; consumers process them at their own pace.
level: senior
tracks: [concurrency-and-parallelism, patterns]
tags: [kafka, rabbitmq, sqs, messaging]
related: [publishes, consumes, pg.job-queue, node.event]
references:
  - title: Apache Kafka — Introduction
    url: https://kafka.apache.org/intro
  - title: microservices.io — Messaging
    url: https://microservices.io/patterns/communication-style/messaging.html
---

## Beginner

A **message broker** sits between services: one **publishes** messages, others
**consume** them later. Neither waits for the other, and messages are kept until they are
processed.

## Intermediate

- Queues (RabbitMQ, SQS) give each message to one consumer; logs (Kafka) keep messages so
  several consumer groups read them independently.
- Delivery is usually at-least-once: consumers must be idempotent.
- For most single-database apps, a Postgres job queue is simpler.

## Senior

- Ordering is per partition/queue, not global; design keys accordingly.
- Publishing from a transaction needs an outbox.
- Plan schemas and versioning of messages like a public API.

## Common mistakes

- Assuming exactly-once delivery.
- Adding a broker before the problem needs one.

## Examples

**An idempotent consumer:**

```ts
consumer.on('message', async (msg) => {
  const inserted = await db.query(
    'INSERT INTO processed (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id',
    [msg.id],
  );
  if (inserted.rowCount === 0) return; // already handled
  await handle(msg);
});
```
