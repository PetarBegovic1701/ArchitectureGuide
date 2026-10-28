---
id: node.dto
kind: concept
title: Data shape (DTO)
summary: The shape of data that crosses a boundary — a request body, a response, an event payload. Not the same as the table or the domain object.
level: beginner
tracks: [data-and-models, api-design]
tags: [dto, schema, zod, payload]
related: [topic.models, node.endpoint, node.contract, pg.table, node.domain]
references:
  - title: Martin Fowler — Data transfer object
    url: https://martinfowler.com/eaaCatalog/dataTransferObject.html
  - title: Zod — Basic usage
    url: https://zod.dev/basics
quiz:
  - question: Why not return the database row of a user directly from GET /me?
    options:
      [
        Rows are too slow,
        The row may contain fields the client must not see — like a password hash — and ties the API to the table,
        JSON cannot hold rows,
        There is no reason,
      ]
    answer: 1
    explanation: A response DTO lists exactly what the client gets, so internal columns never leak and the table can change without breaking clients.
---

## Beginner

A **DTO** (data transfer object) describes data that travels between parts: what the
browser sends to create an order, what the API returns for an order list, what an event
carries.

It is often different from the database table: a user row has a password hash; the
`UserResponse` DTO must not.

## Intermediate

- One DTO per direction and purpose: `CreateOrderRequest`, `OrderSummary`,
  `OrderDetails`.
- Validate request DTOs at the boundary; map rows or domain objects to response DTOs.
- Share DTOs through a contract package; the frontend may depend on it.
- In this tool, a DTO can list its fields; endpoints point to their request and response
  DTOs.

## Senior

- DTOs are your compatibility surface: evolve them additively.
- Avoid "god DTOs" reused everywhere with optional fields for every case.
- For events, include a version and only the facts consumers need.

## Common mistakes

- Returning ORM entities (leaks fields, couples API to schema).
- One DTO for create, update and read with everything optional.

## Examples

**Request and response DTOs:**

```ts
export const CreateOrderRequest = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10),
});

export type OrderSummary = { id: string; status: 'new' | 'paid' | 'shipped'; total: number };
```
