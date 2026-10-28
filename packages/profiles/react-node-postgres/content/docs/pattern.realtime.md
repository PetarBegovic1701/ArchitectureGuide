---
id: pattern.realtime
kind: pattern
title: Realtime updates with LISTEN/NOTIFY
summary: The browser keeps a WebSocket open to a realtime gateway; services signal changes with PostgreSQL NOTIFY, the gateway pushes them, and the browser reloads the data through the API.
level: intermediate
tracks: [patterns, api-design]
tags: [websocket, socket.io, listen-notify, realtime, push]
related:
  [node.ws-gateway, pg.channel, notifies, listens, react.server-state, pattern.background-jobs]
references:
  - title: PostgreSQL docs — NOTIFY
    url: https://www.postgresql.org/docs/current/sql-notify.html
  - title: Socket.IO documentation
    url: https://socket.io/docs/v4/
  - title: TanStack Query — Query invalidation
    url: https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation
quiz:
  - question: Why should a NOTIFY message only say "order 42 changed" and not carry the whole order?
    options:
      - NOTIFY payloads are limited and messages are lost when nobody listens, so the client reloads the real data
      - It is faster to send big messages
      - The browser cannot parse JSON
      - PostgreSQL forbids JSON in NOTIFY
    answer: 0
    explanation: NOTIFY is fire-and-forget with a payload limit of about 8 KB. Use it as a signal; the source of truth stays in the tables and the API.
---

## Beginner

Normally the browser asks the server for data. For live screens (order status, chat,
dashboards) the server should tell the browser when something changes. A **WebSocket**
keeps a connection open so the server can push.

With PostgreSQL you get the "something changed" signal for free: a service runs
`NOTIFY order_changed, '42'` in the transaction that changes order 42. A **realtime
gateway** runs `LISTEN order_changed` and pushes the signal to the browsers that watch
order 42. The browser then reloads the order through the normal API.

## Intermediate

- NOTIFY is delivered only after the transaction commits, and only to sessions that
  are listening right now. Messages are not stored.
- Keep payloads small (IDs). The limit is about 8000 bytes.
- The gateway needs one dedicated connection for LISTEN; transaction-mode poolers
  (PgBouncer) do not support LISTEN.
- Authenticate every socket connection and check that a user may join a room.
- In the browser, invalidate the server-state cache entry on a signal instead of
  patching data by hand.
- Work that must happen (sending a receipt) goes through a job queue, not NOTIFY.

## Senior

Scale the gateway horizontally with a shared adapter (the socket.io Postgres or Redis
adapter) so a signal reaches clients on every instance. Clients reconnect after
network drops and must refetch, because signals sent while they were away are gone.
At high message rates move to a dedicated pub/sub or a managed realtime service; keep
the "signal, then reload" contract so the client code does not change.

## Analogy

A doorbell: it tells you someone is at the door, not what they brought. You open the
door (the API) to see.

## Common mistakes

- Sending whole rows in NOTIFY.
- Using NOTIFY for work that must not be lost.
- A gateway that does not authenticate sockets.
- LISTEN through a transaction-pooling connection.

## Examples

**Signal in the same transaction as the change:**

```sql
BEGIN;
UPDATE orders SET status = 'paid' WHERE id = 42;
SELECT pg_notify('order_changed', '42');
COMMIT;
```

**Gateway: listen and push to the room of that order (socket.io):**

```ts
const client = await pool.connect();
await client.query('LISTEN order_changed');
client.on('notification', (msg) => {
  io.to(`order:${msg.payload}`).emit('order_changed', { id: msg.payload });
});
```
