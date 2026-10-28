---
id: gen.external
kind: concept
title: External system
summary: A system outside your control — Stripe, SendGrid, a partner API. It can be slow or down; design every call to it for failure.
level: beginner
tracks: [foundations, concurrency-and-parallelism]
tags: [third-party, integration, resilience]
related: [node.service, node.worker, calls]
references:
  - title: Martin Fowler — Circuit breaker
    url: https://martinfowler.com/bliki/CircuitBreaker.html
  - title: Stripe docs — Idempotent requests
    url: https://docs.stripe.com/api/idempotent_requests
---

## Beginner

An **external system** is a service someone else runs: payments (Stripe), email
(SendGrid), shipping labels, a partner's API. You cannot change it, and sometimes it is
slow or unavailable.

Your backend calls it; the browser usually does not (it would need your keys).

## Intermediate

- Always set **timeouts**; a hanging call blocks your request.
- Retry only safe calls, or send an **idempotency key** (Stripe supports this) so a retry
  does not charge twice.
- Slow or non-urgent calls (emails) belong in a background job.
- Keep the provider behind a port/adapter so you can test without it and switch later.

## Senior

- Use circuit breakers or bulkheads so a failing provider does not exhaust your
  connections or event loop.
- Webhooks from providers arrive at least once and out of order: verify signatures, store
  and deduplicate by event ID.
- Record what you sent and received for support and reconciliation.

## Common mistakes

- No timeout.
- Retrying payments without an idempotency key.
- Calling a slow provider inside a database transaction.

## Examples

**A call with a timeout and an idempotency key:**

```ts
await fetch('https://api.example-payments.com/charges', {
  method: 'POST',
  headers: { 'Idempotency-Key': orderId, Authorization: `Bearer ${KEY}` },
  body: JSON.stringify({ amount, currency: 'eur' }),
  signal: AbortSignal.timeout(5000),
});
```
