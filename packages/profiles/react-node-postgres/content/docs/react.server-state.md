---
id: react.server-state
kind: concept
title: State management — server state vs client state
summary: Data that belongs to the server (orders, users) needs caching and refetching; data that belongs to the UI (open dialogs, drafts) needs a simple store. Mixing them causes stale screens.
level: beginner
tracks: [state-management]
tags: [react, tanstack-query, zustand]
related: [react.client-store, react.api-client, uses-state, fetches-via, topic.models]
references:
  - title: TanStack Query — Overview
    url: https://tanstack.com/query/latest/docs/framework/react/overview
  - title: TanStack Query — Optimistic updates
    url: https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates
  - title: React docs — Managing state
    url: https://react.dev/learn/managing-state
quiz:
  - question: Where should the list of the user's orders live in a React app?
    options:
      [
        A Redux slice filled in useEffect,
        A server-state cache such as TanStack Query,
        localStorage,
        A global variable,
      ]
    answer: 1
    explanation: The orders belong to the server. A server-state cache handles loading, errors, caching, refetching and invalidation for you.
---

## Beginner

React apps hold two very different kinds of state:

- **Server state:** data that lives on the server and that you only _borrow_ — orders,
  products, the user profile. Others can change it at any time, so your copy can go stale.
- **Client state:** data that only exists in the browser — is the menu open, which tab
  is selected, what the user typed in a form that is not saved yet.

Use a **server-state cache** (TanStack Query, SWR, RTK Query, Apollo) for the first: it
loads data, caches it, shows loading and error states, and refetches when needed. Use
`useState`, Context, or a small store (Zustand) for the second.

## Intermediate

- Each query has a **key** (`['orders', userId]`). Same key = same cached data, shared by
  every component that asks for it.
- **staleTime** says how long cached data counts as fresh (TanStack Query's default is 0:
  refetch on mount, window focus and reconnect).
- After a change (**mutation**), **invalidate** the affected keys so they refetch.
- **Optimistic update:** change the cache immediately, roll back if the server says no.
  Good for toggles and likes, risky for payments.
- Keep state as **local** as you can; lift it up only when two components need it.
- Derived values (totals, filtered lists) are computed during render, not stored.

## Senior

- The cache is a replica with eventual consistency; decide per screen how stale is
  acceptable and how to recover (refetch on focus, polling, or server push via a
  realtime gateway that invalidates keys).
- Design query keys like an API: hierarchical (`['orders', 'list', filters]`,
  `['orders', 'detail', id]`) so you can invalidate a whole branch.
- Concurrency in the UI: cancel in-flight queries before optimistic writes
  (`cancelQueries`), and make mutations idempotent on the server, because users
  double-click and networks retry.
- SSR/hydration (outside this profile's SPA scope) changes where the first fetch happens,
  not the model.
- Global client stores are for genuinely global UI state (theme, auth session flags,
  feature flags); a store that mirrors server tables is a cache you now maintain by hand.

## Analogy

Server state is a library book: you can read your copy, but the library has the real
one and it may have a newer edition. Client state is your own notebook.

## Common mistakes

- Fetching in `useEffect` and copying the result into Redux or Zustand.
- Forgetting to invalidate after a mutation, so the list shows old data.
- Storing derived data (totals) and letting it drift.
- One giant global store for everything.

## Examples

**Read and change server state with TanStack Query:**

```tsx
function useOrders() {
  return useQuery({ queryKey: ['orders', 'list'], queryFn: () => api.get('/orders') });
}

function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/orders/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  });
}
```

**Client state in a small Zustand store:**

```ts
import { create } from 'zustand';

type CartUi = { open: boolean; toggle: () => void };

export const useCartUi = create<CartUi>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
}));
```
