---
id: node.route-handler
kind: concept
title: Controller / route handler
summary: Code that receives an HTTP request, validates it, calls the business logic, and turns the result into an HTTP response. Thin by design.
level: beginner
tracks: [api-design]
tags: [express, fastify, nestjs, controller]
related: [node.endpoint, node.use-case, node.middleware, node.dto]
references:
  - title: Express — Routing
    url: https://expressjs.com/en/guide/routing.html
  - title: NestJS — Controllers
    url: https://docs.nestjs.com/controllers
quiz:
  - question: A handler for POST /orders runs SQL queries to check stock and insert rows. What is the main problem?
    options:
      [
        SQL is slow,
        Business rules end up in the HTTP layer and cannot be reused by jobs or tests without HTTP,
        Handlers cannot use SQL,
        Nothing,
      ]
    answer: 1
    explanation: Handlers should translate HTTP; a use case holds the rules and a repository runs the queries (RNP-005).
---

## Beginner

A **route handler** (a controller in NestJS) is where a request enters your code:

1. read the request (path, query, body),
2. **validate** it,
3. call the business logic (a use case),
4. turn the result into a response with the right **status code**.

Keep it thin: no SQL, no business rules. Those belong in the use case and the repository.

## Intermediate

- Validate with a schema (zod, TypeBox, class-validator) and return 400 with details on
  failure (RNP-015 flags handlers without validation).
- Map domain errors to HTTP: "out of stock" → 409, "not found" → 404.
- One handler groups the endpoints of one resource (`/orders`, `/orders/:id`).

## Senior

- Handlers are adapters: the same use case should be callable from HTTP, a job, a CLI.
- Keep auth decisions explicit: middleware for "who are you", the use case for "may you
  do this to that order" (ownership).
- Use one error shape across the API (Problem Details, RFC 9457).

## Common mistakes

- Queries and business rules in handlers (RNP-005).
- Returning 200 with `{ error: … }`.
- No input validation.

## Examples

**A thin handler (Express + zod):**

```ts
const Body = z.object({ productId: z.string(), quantity: z.number().int().min(1) });

router.post('/orders', requireSession, async (req, res) => {
  const input = Body.safeParse(req.body);
  if (!input.success) return res.status(400).json({ errors: input.error.issues });
  const order = await placeOrder(req.user.id, input.data);
  res.status(201).location(`/orders/${order.id}`).json(order);
});
```
