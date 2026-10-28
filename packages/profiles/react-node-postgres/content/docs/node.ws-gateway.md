---
id: node.ws-gateway
kind: concept
title: Realtime gateway (WebSocket)
summary: Keeps open connections to browsers and pushes updates — "your order shipped", live stock — instead of making the browser ask again and again.
level: intermediate
tracks: [patterns, concurrency-and-parallelism]
tags: [websocket, socket.io, realtime, push]
related: [pg.channel, listens, react.server-state, node.service]
references:
  - title: MDN — The WebSocket API
    url: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
  - title: Socket.IO — Introduction
    url: https://socket.io/docs/v4/
---

## Beginner

Normally the browser asks and the server answers. For live updates — chat messages, an
order status, stock levels — asking every few seconds is wasteful and slow.

A **realtime gateway** keeps a WebSocket connection open to each browser and **pushes**
messages when something changes.

## Intermediate

- Authenticate the connection (cookie or token at connect time) and authorize each
  subscription ("may this user see order 42?").
- With several gateway instances, a message must reach the instance that holds the
  user's connection: use a pub/sub channel (Postgres LISTEN/NOTIFY, Redis).
- Push a small "something changed" message and let the client refetch, or push the data
  itself if it is small.

## Senior

- NOTIFY is not durable: clients that are offline miss messages. On reconnect, the client
  must refetch the current state.
- Connections are long-lived: plan for many idle sockets per instance, heartbeats, and
  load balancers that support WebSockets.
- Backpressure: a slow client must not make the gateway buffer unlimited messages.

## Common mistakes

- No refetch after reconnect, so the screen stays stale.
- Broadcasting private data to everyone subscribed to a broad channel.

## Examples

**Push an invalidation and let the client refetch:**

```ts
// server (Socket.IO)
io.to(`user:${userId}`).emit('invalidate', ['orders', orderId]);

// client
socket.on('invalidate', (key) => queryClient.invalidateQueries({ queryKey: key }));
```
