---
id: fetches-via
kind: relation
title: fetches via
summary: React code loads data through the API client — a query, a thunk or an effect calls the backend.
level: beginner
tracks: [state-management, api-design]
tags: [fetch, api-client]
related: [react.api-client, react.server-state, react.action, react.effect]
references:
  - title: TanStack Query — Query functions
    url: https://tanstack.com/query/latest/docs/framework/react/guides/query-functions
---

## Beginner

`Orders query fetches via API client` means the data for the orders list is loaded by
calling the API client, which sends the HTTP request.

## Intermediate

- Prefer fetching from a server-state cache (queries) over effects and thunks; it handles
  caching, retries and deduplication.
- All calls go through the one API client, never `fetch` scattered in components.

## Senior

- Avoid request waterfalls: start independent fetches in parallel; prefetch on
  navigation intent.

## Common mistakes

- Fetching the same data in several components without a shared cache.

## Examples

**A query that fetches via the client:**

```ts
useQuery({ queryKey: ['orders'], queryFn: () => api<Order[]>('/orders') });
```
