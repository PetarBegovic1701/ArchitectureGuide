---
id: uses-state
kind: relation
title: uses state
summary: React code reads or updates a client store or a server-state cache — a component reads the cart with a selector, a page reads orders from the query cache.
level: beginner
tracks: [state-management]
tags: [react, state, selectors]
related: [react.client-store, react.server-state, react.hook, updates]
references:
  - title: Redux — useSelector
    url: https://react-redux.js.org/api/hooks#useselector
  - title: TanStack Query — Queries
    url: https://tanstack.com/query/latest/docs/framework/react/guides/queries
---

## Beginner

`Header uses state of Cart store` means the header reads the cart from the store and shows
the item count. When the cart changes, the header updates.

## Intermediate

- Read with selectors so only the parts you need trigger re-renders.
- Changes go through actions (`dispatches` → action → `updates`), not direct writes.

## Senior

- Many components using a broad slice cause re-render storms; select narrowly and
  derive.

## Common mistakes

- Selecting the whole store in every component.

## Examples

**A narrow selector:**

```tsx
const count = useSelector((s: RootState) => s.cart.items.length);
```
