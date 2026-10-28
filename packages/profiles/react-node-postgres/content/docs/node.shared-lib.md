---
id: node.shared-lib
kind: concept
title: Shared package
summary: A workspace package used by several apps — configuration, logging, small utilities, types. Useful in small doses; dangerous when business logic moves in.
level: intermediate
tracks: [patterns]
tags: [monorepo, pnpm-workspaces, packages]
related: [node.module, node.contract, depends-on]
references:
  - title: pnpm — Workspaces
    url: https://pnpm.io/workspaces
  - title: Turborepo — Structuring a repository
    url: https://turborepo.com/docs/crafting-your-repository/structuring-a-repository
---

## Beginner

In a monorepo, code used by several apps — reading configuration, a logger, date helpers
— can live in a **shared package** that the apps depend on, instead of being copied.

## Intermediate

- Keep shared packages small and stable; every change affects every app.
- Good candidates: config loading, logging, error types, API contracts.
- Bad candidates: business rules of one module ("shared" becomes "everyone's").

## Senior

- Shared code couples release cycles. Prefer duplication over the wrong abstraction for
  small helpers.
- Give each package a clear owner and run its tests in CI for every consumer change.

## Common mistakes

- A `common` package that grows into the real application.
- Shared packages importing app code (cycles).

## Examples

**A shared config package:**

```ts
// packages/config/src/index.ts
import { z } from 'zod';

export const config = z
  .object({ DATABASE_URL: z.string().url(), PORT: z.coerce.number().default(3000) })
  .parse(process.env);
```
