---
id: listens
kind: relation
title: listens
summary: Runs LISTEN on a channel and receives its notifications while connected.
level: intermediate
tracks: [concurrency-and-parallelism]
tags: [listen, realtime]
related: [pg.channel, notifies, node.ws-gateway]
references:
  - title: PostgreSQL docs — LISTEN
    url: https://www.postgresql.org/docs/current/sql-listen.html
---

## Beginner

`Gateway listens to stock_changed` means the gateway keeps a database connection open and
gets every notification sent on that channel.

## Intermediate

- Needs a dedicated connection (not through a transaction-mode pooler).
- After a reconnect, refetch state: messages sent while disconnected are gone.

## Senior

- One listener per process is enough; fan out inside the process.

## Common mistakes

- Listening through PgBouncer in transaction mode.

## Examples

**Listen on a dedicated client:**

```ts
const client = new pg.Client(config);
await client.connect();
await client.query('LISTEN stock_changed');
```
