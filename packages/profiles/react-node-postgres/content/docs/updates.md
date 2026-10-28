---
id: updates
kind: relation
title: updates
summary: An action changes the state in a store — a reducer case, set() in Zustand — or updates or invalidates cached server data.
level: beginner
tracks: [state-management]
tags: [reducers, state, cache-invalidation]
related: [react.action, react.client-store, react.server-state, dispatches]
references:
  - title: Redux — Reducers
    url: https://redux.js.org/tutorials/fundamentals/part-3-state-actions-reducers#writing-reducers
  - title: TanStack Query — Invalidations from mutations
    url: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations
---

## Beginner

`addToCart updates Cart store` means the action is what changes the cart state. Nothing
else writes the store directly.

## Intermediate

- Reducers are pure: same state and action, same result.
- An action can also update the server-state cache: set data optimistically or invalidate
  a query after a mutation.

## Senior

- An action that both fetches from the API and updates a client store duplicates the
  server-state cache (RNP-012 tip).

## Common mistakes

- Mutating state outside reducers.

## Examples

**Invalidate cached orders after a change:**

```ts
await api.post(`/orders/${id}/cancel`);
queryClient.invalidateQueries({ queryKey: ['orders'] });
```
