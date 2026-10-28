---
id: react.route
kind: concept
title: Route / page
summary: A screen reachable by URL. The router picks the page for the current address, so links, the back button and bookmarks work.
level: beginner
tracks: [foundations, state-management]
tags: [react-router, tanstack-router, navigation]
related: [react.layout, react.component, navigates, react.server-state, react.app]
references:
  - title: React Router — Routing
    url: https://reactrouter.com/start/framework/routing
  - title: TanStack Router — Overview
    url: https://tanstack.com/router/latest/docs/framework/react/overview
---

## Beginner

A **route** connects a URL to a page: `/products` shows the product list,
`/products/42` shows one product, `/checkout` shows the checkout form.

Because every page has its own address, users can bookmark it, share it, and use the
browser's back button. The router changes the page **without** reloading the whole app.

A route usually **renders** components, **uses state** (data from the server or a store),
and **navigates** to other routes.

## Intermediate

- **Parameters:** `/orders/:id` gives the page the order ID; search parameters
  (`?page=2&sort=price`) keep list state in the URL, so it survives a reload.
- **Lazy routes** load their code only when visited, which keeps the first download small.
- **Protected routes** redirect to sign-in when there is no session. This is only a
  convenience: the API must still check every request.
- Load data per route (a loader, or a query hook at the top of the page) and show
  loading and error states.

## Senior

- Put state that the user should be able to share or restore (filters, tabs, pagination)
  in the URL; it is the cheapest persistence you have.
- Route-level code splitting is the biggest bundle win in most SPAs.
- Start data fetching as early as possible (route loaders, prefetch on hover) to avoid
  request waterfalls: page loads, then component loads, then its data.
- Keep route components thin: they compose features and pass IDs; business logic lives in
  hooks, stores and the API.

## When to use

- Every screen a user can open directly or should be able to bookmark.

## Common mistakes

- Keeping filters and pagination only in component state, so a reload loses them.
- Treating a hidden route as security.
- Fetching in a chain (page → child → grandchild) instead of in parallel.

## Examples

**Routes with a parameter and lazy loading (React Router):**

```tsx
import { createBrowserRouter } from 'react-router';

export const router = createBrowserRouter([
  { path: '/', lazy: () => import('./pages/Home') },
  { path: '/products/:id', lazy: () => import('./pages/Product') },
  { path: '/checkout', lazy: () => import('./pages/Checkout') },
]);
```
