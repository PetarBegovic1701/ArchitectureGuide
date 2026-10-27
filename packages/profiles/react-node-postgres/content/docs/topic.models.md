---
id: topic.models
kind: topic
title: Models — domain, persistence, DTO and view models
summary: The same "order" exists in several shapes; keeping the database row, the domain object, the API shape and the UI shape apart lets each change on its own.
level: beginner
tracks: [data-and-models, foundations]
tags: [modeling, dto, ddd]
related: [node.domain, node.dto, pg.table, react.server-state, node.endpoint]
references:
  - title: Martin Fowler — Data Transfer Object
    url: https://martinfowler.com/eaaCatalog/dataTransferObject.html
  - title: Martin Fowler — Domain Model
    url: https://martinfowler.com/eaaCatalog/domainModel.html
quiz:
  - question: The users table has a password_hash column. Which model should never contain it?
    options: [Persistence model, Response DTO, Domain model, None of them]
    answer: 1
    explanation: The response DTO is what leaves your server. It is shaped for the client and leaves out secrets and internal fields.
---

## Beginner

"Model" means "the shape of some data". In a full-stack app one thing, for example an
**order**, appears in several shapes:

| Model                          | Lives in                               | Example                                                        |
| ------------------------------ | -------------------------------------- | -------------------------------------------------------------- |
| **Persistence model**          | PostgreSQL table, Prisma/Drizzle model | `orders(id, customer_id, status, total_cents, created_at)`     |
| **Domain model**               | Node service, business code            | `Order` with `cancel()` that refuses to cancel a shipped order |
| **DTO** (data transfer object) | API request and response               | `{ id, status, total: "12.50 EUR", items: [...] }`             |
| **View model**                 | React component                        | `{ title: "Order #42", canCancel: true }`                      |

Beginners often use one shape everywhere. That works for small apps, but then every
database change breaks the API and the UI, and private columns leak to the browser.

## Intermediate

- Map between shapes at the boundaries: repository (row ↔ domain), route handler or
  use case (domain ↔ DTO), React hook or selector (DTO ↔ view model).
- Validate DTOs at the edge (zod). Share request/response schemas between React and
  Node through a contract package, not the database types.
- Money: integer cents (or `numeric`) in the database, a formatted string or
  `{amount, currency}` in DTOs. Never floats.
- Dates: `timestamptz` in PostgreSQL, ISO 8601 strings in JSON.

## Senior

- In DDD terms the domain model holds **invariants** (rules that must always be true)
  inside aggregates; the persistence model is an implementation detail behind a
  repository port. Reach for this when rules are rich; for CRUD screens a thinner model is
  fine.
- Separate read models (CQRS-lite) when screens need joined or denormalized data:
  a SQL view or a projection table can serve the DTO directly.
- Versioned DTOs decouple deploys: the API keeps accepting the old shape while clients
  move to the new one.
- Generated types (Prisma client types, OpenAPI → TypeScript) are convenient, but
  generating the DTO _from_ the table couples the API to the schema again.

## Common mistakes

- Returning ORM entities from endpoints.
- Putting business rules in React components because the UI has the data.
- Copying server data into a client store and editing it there.

## Examples

**Persistence, domain and DTO for one user:**

```ts
// Persistence (Prisma model)
// model User { id String @id  email String @unique  passwordHash String  createdAt DateTime @default(now()) }

// Response DTO: what leaves the server
export const UserResponse = z.object({ id: z.string(), email: z.email(), memberSince: z.string() });
export type UserResponse = z.infer<typeof UserResponse>;

export function toUserResponse(user: { id: string; email: string; createdAt: Date }): UserResponse {
  return { id: user.id, email: user.email, memberSince: user.createdAt.toISOString() };
}
```
