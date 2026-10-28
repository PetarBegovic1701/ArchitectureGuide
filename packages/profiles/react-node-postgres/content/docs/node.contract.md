---
id: node.contract
kind: concept
title: API contract package
summary: The shared description of an API — OpenAPI, zod schemas, a tRPC router type — that both the client and the server use, so they cannot drift apart.
level: intermediate
tracks: [api-design]
tags: [openapi, zod, trpc, contract-first]
related: [node.endpoint, node.dto, react.api-client, depends-on]
references:
  - title: OpenAPI Specification
    url: https://spec.openapis.org/oas/latest.html
  - title: tRPC — Introduction
    url: https://trpc.io/docs
---

## Beginner

The frontend and backend must agree on every request and response: the path, the fields,
their types. An **API contract** writes that agreement down in one place.

Both sides use it: the server to validate requests, the client to get typed functions.
When the contract changes, type errors show what to update.

## Intermediate

- **Contract-first:** write `openapi.yaml`, generate server stubs and the client.
- **Code-first:** write zod schemas or a tRPC router, and derive types and docs from them.
- Put endpoints and their data shapes (DTOs) inside the contract shape on the canvas.
- Browser code may depend on the contract package; it may not depend on server code.

## Senior

- Version and evolve compatibly: add optional fields, never change the meaning of an
  existing one; deprecate before removing.
- Run contract tests in CI (schema diff, consumer tests) to catch breaking changes.
- For public APIs, publish the OpenAPI document and generate SDKs.

## Common mistakes

- Sharing server code with the client to "share types" (and leaking server-only code).
- Types that say one thing while the server returns another; validate at the boundary.

## Examples

**A zod contract used by client and server:**

```ts
// packages/api-contract/src/orders.ts
import { z } from 'zod';

export const CreateOrder = z.object({ productId: z.string(), quantity: z.number().int().min(1) });
export const OrderSummary = z.object({
  id: z.string(),
  status: z.enum(['new', 'paid']),
  total: z.number(),
});
export type CreateOrder = z.infer<typeof CreateOrder>;
```
