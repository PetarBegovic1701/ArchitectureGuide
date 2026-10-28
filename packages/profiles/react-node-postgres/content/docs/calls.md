---
id: calls
kind: relation
title: calls
summary: A synchronous request and response — the caller waits for the answer. Set the protocol, auth, timeout and whether it is safe to retry.
level: beginner
tracks: [foundations, api-design]
tags: [http, rpc, sync]
related: [node.service, react.api-client, gen.external, publishes]
references:
  - title: MDN — An overview of HTTP
    url: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview
  - title: Microsoft — Retry pattern
    url: https://learn.microsoft.com/en-us/azure/architecture/patterns/retry
---

## Beginner

`A calls B` means A sends B a request and **waits** for the answer: the React app calls
the API, the API calls the payment provider. If B is slow or down, A is slow or fails too.

## Intermediate

- Properties on the arrow document the decisions: `protocol` (http, graphql, trpc),
  `auth` (session cookie, bearer token, API key), `timeoutMs`, `idempotent`,
  `idempotencyKey`.
- Every call needs a timeout.
- Retry only idempotent calls, or send an idempotency key.

## Senior

- Chains of synchronous calls multiply latency and failure probability; prefer one hop
  from the frontend (a BFF) and async messaging between services where possible.
- This tool flags retried calls that are not idempotent (RNP-023) and frontends that call
  many services (RNP-011).

## Common mistakes

- No timeout.
- Retrying POST without an idempotency key.
- Long call chains on the request path.

## Examples

**A call with timeout and retry only for safe methods:**

```ts
const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2000) });
```
