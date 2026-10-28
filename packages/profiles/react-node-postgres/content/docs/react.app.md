---
id: react.app
kind: concept
title: React app (single-page app)
summary: The part of the system that runs in the browser. It draws the screens and sends requests to the backend; it never holds secrets.
level: beginner
tracks: [foundations]
tags: [react, vite, spa, frontend]
related: [react.route, react.api-client, node.service, topic.authentication, serves]
references:
  - title: React docs — Quick start
    url: https://react.dev/learn
  - title: Vite — Getting started
    url: https://vite.dev/guide/
  - title: MDN — Single-page application (SPA)
    url: https://developer.mozilla.org/en-US/docs/Glossary/SPA
quiz:
  - question: Where may a React app keep the secret key for the payment provider?
    options:
      [
        In an environment variable read by Vite,
        In localStorage,
        Nowhere — only the backend may hold it,
        In a hidden form field,
      ]
    answer: 2
    explanation: Everything shipped to the browser can be read with the developer tools, including Vite environment variables. Secrets stay on the server.
---

## Beginner

A **React app** is the code that runs in the user's browser. The browser downloads it
once (HTML, JavaScript, CSS); after that the app draws every screen itself and only asks
the server for **data**.

- It shows screens, reacts to clicks and typing, and checks forms for obvious mistakes.
- It sends **requests** to the backend (`GET /api/products`, `POST /api/orders`).
- It never talks to the database, and it never holds secrets: anyone can read its code
  with the browser's developer tools.

In this tool, a React app is a top-level shape. Routes, features, stores and the API
client go **inside** it.

## Intermediate

- **Build:** Vite bundles the code into static files. Any static host (a CDN, or the
  Node service with the `serves` relation) can deliver them.
- **Routing:** a router (React Router, TanStack Router) maps URLs to pages without a full
  page load.
- **State:** server data in a server-state cache (TanStack Query), shared UI state in a
  small store, the rest in components.
- **Config:** `import.meta.env.VITE_*` values are baked into the bundle at build time.
  They are public.
- **Validation in the browser is for comfort only.** The API must validate everything
  again.

## Senior

- A SPA moves rendering cost to the client: watch bundle size (code-split routes with
  `lazy`), first paint, and slow devices.
- Auth in a SPA: prefer an HttpOnly session cookie, or a backend-for-frontend that keeps
  tokens server-side. Tokens in `localStorage` are readable by any XSS.
- Treat the app as an untrusted client of your API. Every rule that matters (prices,
  permissions, stock) is enforced on the server.
- Deploy the static build with long cache lifetimes and hashed file names; keep
  `index.html` uncached so new releases load.
- Server-side rendering (Next.js, RSC) is a different deployment model and outside this
  profile.

## Analogy

The React app is the shop window and the counter: it shows things and takes orders, but
the stockroom and the cash register are in the back (the API and the database).

## When to use

- Interactive applications: dashboards, shops, editors, admin tools.
- When the same API also serves mobile apps or partners.

## When not to use

- Mostly static content that must load instantly for search engines (consider static
  generation or SSR).

## Common mistakes

- Putting API keys or secrets in the frontend code or `VITE_` variables.
- Trusting browser validation instead of validating again in the API.
- Calling five backend services directly from the browser instead of one API or a BFF.
- Storing auth tokens in `localStorage`.

## Examples

**The entry point of a Vite + React app:**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```
