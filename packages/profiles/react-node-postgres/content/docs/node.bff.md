---
id: node.bff
kind: concept
title: Backend-for-Frontend (BFF)
summary: A small backend made for one frontend. It combines calls to other services into the shape that screen needs, and can keep tokens out of the browser.
level: intermediate
tracks: [patterns, auth, api-design]
tags: [bff, aggregation, gateway]
related: [pattern.bff, react.app, node.service, topic.authentication]
references:
  - title: Sam Newman — Backends for Frontends
    url: https://samnewman.io/patterns/architectural/bff/
  - title: OAuth 2.0 for Browser-Based Apps (IETF draft) — BFF
    url: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps
---

## Beginner

When a screen needs data from several backend services, the browser could call all of
them. That is slow on mobile networks and spreads backend details into the frontend.

A **Backend-for-Frontend** is one service per frontend (web, mobile) that does those calls
**for** the screen and returns exactly what it needs, in one response.

## Intermediate

- The frontend team owns its BFF; it changes with the UI.
- Call backend services in parallel with timeouts; decide per field what a partial
  failure shows.
- A BFF is a good place for the sign-in flow: it runs OpenID Connect, keeps tokens on the
  server, and gives the browser an HttpOnly session cookie.
- This tool flags a React app that calls more than two services directly (RNP-011).

## Senior

- Avoid business rules in the BFF; it composes and adapts, the services decide.
- One BFF per experience, not one per team or per page; too many BFFs duplicate code.
- Watch for a BFF that becomes a distributed monolith's front door; share code through
  libraries, not by making BFFs call each other.

## Common mistakes

- Putting domain logic in the BFF.
- Calling services one after another instead of in parallel.
- A single "BFF" shared by web and mobile, which then serves neither well.

## Examples

**Aggregate two services in parallel:**

```ts
app.get('/home', async () => {
  const [user, recommendations] = await Promise.all([
    fetch(`${USERS}/me`, { signal: AbortSignal.timeout(800) }).then((r) => r.json()),
    fetch(`${RECS}/for-me`, { signal: AbortSignal.timeout(800) })
      .then((r) => r.json())
      .catch(() => []), // the home screen still works without recommendations
  ]);
  return { name: user.name, recommendations };
});
```
