---
id: react.hook
kind: concept
title: Custom hook
summary: A function whose name starts with "use" that packages reusable logic — loading data, reading a store, handling a form — so components stay small.
level: beginner
tracks: [state-management]
tags: [react, hooks]
related: [react.component, react.server-state, react.client-store, react.effect, uses-state]
references:
  - title: React docs — Reusing logic with custom hooks
    url: https://react.dev/learn/reusing-logic-with-custom-hooks
  - title: React docs — Rules of Hooks
    url: https://react.dev/reference/rules/rules-of-hooks
---

## Beginner

A **custom hook** is a function named `useSomething` that other components call to get
reusable behavior. `useCart()` can return the cart and functions to add or remove items;
`useOrders()` can load the user's orders.

The component stays simple ("show the cart"), and the details (which store, which API
call) live in one place.

## Intermediate

- Hooks can use other hooks: `useOrders` wraps `useQuery`, `useCart` wraps a Zustand or
  Redux selector.
- Name hooks after what they give, not how: `useCurrentUser`, not `useFetchMeEffect`.
- Hooks must be called at the top level of a component, in the same order every render.
- A hook is the natural boundary for tests: test the hook, keep components dumb.

## Senior

- Hooks are the seam between UI and data. Keeping server access behind entity hooks
  (`useProduct(id)`) makes it cheap to switch libraries or add caching.
- Avoid hooks that return a new object every render if consumers memoize on it; return
  stable callbacks (`useCallback`) where it matters.
- A hook that only wraps `useEffect` + `useState` to fetch data usually wants to be a
  query in a server-state cache instead.

## Common mistakes

- Calling hooks inside conditions or loops.
- Hiding a full data-fetching and caching layer in a hand-written hook instead of using a
  server-state cache.
- Hooks that do too many things; split them.

## Examples

**A hook that hides where the cart lives:**

```ts
import { useCartStore } from './cartStore';

export function useCart() {
  const items = useCartStore((s) => s.items);
  const add = useCartStore((s) => s.add);
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  return { items, add, total };
}
```
