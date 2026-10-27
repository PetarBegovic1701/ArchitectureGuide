---
id: node.endpoint
kind: concept
title: Designing API endpoints
summary: An endpoint is one operation of your API. Good endpoints use clear resource names, the right HTTP method, precise status codes and validated inputs.
level: beginner
tracks: [api-design]
tags: [rest, http]
related:
  [
    node.dto,
    node.route-handler,
    node.contract,
    topic.concurrency-control,
    topic.authentication,
    calls,
  ]
references:
  - title: RFC 9110 — HTTP Semantics
    url: https://www.rfc-editor.org/rfc/rfc9110
  - title: RFC 9457 — Problem Details for HTTP APIs
    url: https://www.rfc-editor.org/rfc/rfc9457
  - title: OpenAPI Specification
    url: https://spec.openapis.org/oas/latest.html
quiz:
  - question: Which status code fits "the order was created"?
    options: ['200 OK', '201 Created', '204 No Content', '202 Accepted']
    answer: 1
    explanation: 201 Created, ideally with a Location header that points at the new order.
  - question: Which method is NOT idempotent by definition?
    options: [GET, PUT, DELETE, POST]
    answer: 3
    explanation: Repeating a POST can create a second item. Use an idempotency key if clients may retry.
---

## Beginner

An **API endpoint** is one thing a client can ask the server to do, for example
`POST /orders` ("create an order") or `GET /orders/42` ("give me order 42").

A simple REST design:

- **Resources are nouns, in plural:** `/orders`, `/orders/42`, `/orders/42/items`.
- **The method says what to do:** `GET` reads, `POST` creates, `PUT` replaces,
  `PATCH` changes part of it, `DELETE` removes.
- **The status code says what happened:** `200 OK`, `201 Created`, `204 No Content`,
  `400 Bad Request` (invalid input), `401 Unauthorized` (not signed in),
  `403 Forbidden` (signed in, but not allowed), `404 Not Found`,
  `409 Conflict`, `500 Internal Server Error`.
- **Never trust the input.** Check the request body against a schema before you use it.

## Intermediate

- **Request and response shapes** are DTOs, not your database rows. Do not return
  columns like `password_hash`.
- **Errors** in one consistent format, for example RFC 9457 Problem Details
  (`application/problem+json` with `type`, `title`, `status`, `detail`).
- **Lists need pagination.** Offset (`?page=3`) is simple; a cursor
  (`?after=ord_123`) stays correct and fast when rows are added.
- **Idempotency:** `GET`, `PUT`, `DELETE` are idempotent by definition; `POST` is not.
  For payments and orders, accept an `Idempotency-Key` header so a retried request does
  not create a duplicate.
- **Versioning:** avoid breaking changes; add fields instead of renaming them. When you
  must break, use a new version (`/v2/...` or a header).
- **Contract:** describe endpoints in OpenAPI (or share zod schemas / a tRPC router) so
  the React client and the server cannot drift apart.

## Senior

- Design around use cases, not tables: `POST /orders/42/cancel` can be clearer and safer
  than `PATCH /orders/42 {status: "cancelled"}` because the server keeps control of
  state transitions.
- Concurrency over HTTP: return an `ETag` and require `If-Match` on updates; answer
  `412 Precondition Failed` on a stale version.
- Long work: return `202 Accepted` with a status resource, and do the work in a worker.
- Consistent authorization per endpoint (declared in the contract, enforced in
  middleware), plus object-level checks in the use case.
- REST vs GraphQL vs tRPC: REST is the most interoperable and cache-friendly; GraphQL
  helps many different clients pick fields but moves complexity to the server (N+1,
  authorization per field, query cost); tRPC gives end-to-end types inside one TypeScript
  monorepo but couples client and server deployments.
- Rate limits (`429` with `Retry-After`) and request size limits on every public endpoint.

## When to use

- Model one endpoint per operation a client needs, and give each one a request shape, a response shape, status codes and an auth rule.

## Common mistakes

- Verbs in paths (`/getOrders`, `/createOrder`).
- `200 OK` with `{"error": ...}` in the body.
- Returning database entities directly.
- Unpaginated list endpoints.
- No input validation, or validation only in the React form.

## Examples

**Express route with zod validation and a 201 response:**

```ts
import { z } from 'zod';

const CreateOrderRequest = z.object({
  items: z.array(z.object({ productId: z.uuid(), quantity: z.number().int().positive() })).min(1),
});

router.post('/orders', requireUser, async (req, res) => {
  const body = CreateOrderRequest.safeParse(req.body);
  if (!body.success) {
    return res.status(400).type('application/problem+json').json({
      type: 'https://example.com/problems/invalid-request',
      title: 'Invalid request',
      status: 400,
      errors: body.error.issues,
    });
  }
  const order = await placeOrder(req.user.id, body.data, req.get('Idempotency-Key'));
  res.status(201).location(`/orders/${order.id}`).json(toOrderResponse(order));
});
```

**The same endpoint in OpenAPI:**

```yaml
paths:
  /orders:
    post:
      summary: Place an order
      security: [{ session: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreateOrderRequest' }
      responses:
        '201':
          {
            description: Created,
            content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } },
          }
        '400': { description: Invalid request }
        '401': { description: Not signed in }
        '409': { description: Out of stock }
```
