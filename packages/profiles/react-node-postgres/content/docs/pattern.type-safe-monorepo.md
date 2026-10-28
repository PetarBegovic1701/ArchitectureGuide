---
id: pattern.type-safe-monorepo
kind: pattern
title: Type-safe monorepo
summary: The React app and the Node API live in one repository and share one API contract (tRPC router types or an OpenAPI document with zod schemas), so a breaking change fails the build.
level: intermediate
tracks: [patterns, api-design]
tags: [monorepo, trpc, openapi, zod, drizzle, end-to-end-types]
related: [node.contract, react.api-client, node.dto, node.service, react.app, pattern.starter]
references:
  - title: tRPC documentation
    url: https://trpc.io/docs
  - title: OpenAPI Specification
    url: https://spec.openapis.org/oas/latest.html
  - title: Zod documentation
    url: https://zod.dev/
  - title: Drizzle ORM documentation
    url: https://orm.drizzle.team/docs/overview
quiz:
  - question: What may the React app import from the server side of the monorepo?
    options:
      - The route handlers
      - The database client
      - Only the contract package (types and schemas)
      - Anything, it is one repository
    answer: 2
    explanation: Browser code must not import server code. The contract package holds only shapes and types, so it is safe to share.
---

## Beginner

When the React app and the API are written by the same team in TypeScript, they can
share one definition of the API: the **contract**. The server implements it; the
client is typed from it. If someone renames a field on the server, the app does not
compile until it is fixed — the mistake never reaches users.

Two common styles:

- **tRPC:** the client imports the router's _types_ and calls procedures like functions.
- **OpenAPI:** the contract is an OpenAPI document (often generated from zod schemas),
  and a typed client is generated from it.

## Intermediate

- Put the contract in its own package (`packages/contract`) with only zod schemas and
  types — no server code, no database client.
- Validate every request on the server with the same schemas.
- The app calls the API only through the typed client; no hand-written `fetch` calls.
- Drizzle gives typed queries and migrations (drizzle-kit) on the server side.
- Build and type-check the workspace in CI, so a contract change is checked against
  every consumer.

## Senior

Shared types couple deploys: an app built against the new contract may talk to an old
API. Deploy API first with additive changes, or version the contract. For public or
third-party clients prefer OpenAPI with explicit versioning over tRPC. Keep the
contract small and stable; internal server types do not belong in it.

## Analogy

Two teams building a bridge from both banks from one set of drawings: if the drawing
changes, both sides see it before the pieces are made.

## Common mistakes

- Importing server modules into the app "just for a type".
- Validating on the client but not on the server.
- Hand-written fetch calls next to the typed client.

## Examples

**A shared schema, used by the server and typed on the client (tRPC):**

```ts
// packages/contract/src/order.ts
export const CreateOrder = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1),
});

// apps/api/src/router.ts
export const appRouter = router({
  createOrder: protectedProcedure
    .input(CreateOrder)
    .mutation(({ input, ctx }) => createOrder(ctx, input)),
});
export type AppRouter = typeof appRouter;

// apps/web/src/api.ts
export const api = createTRPCReact<AppRouter>();
```
