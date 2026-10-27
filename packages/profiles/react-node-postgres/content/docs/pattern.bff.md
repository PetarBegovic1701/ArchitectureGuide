---
id: pattern.bff
kind: pattern
title: Backend-for-frontend (BFF)
summary: A small Node service made for one frontend. It holds the session, calls the backend services, and returns exactly the data each screen needs.
level: intermediate
tracks: [patterns, api-design, auth]
tags: [bff, aggregation, oauth, sessions]
related: [node.bff, react.app, topic.authentication, calls, pattern.database-per-service]
references:
  - title: Sam Newman — Backends For Frontends
    url: https://samnewman.io/patterns/architectural/bff/
  - title: Microsoft — Backends for Frontends pattern
    url: https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends
  - title: IETF — OAuth 2.0 for Browser-Based Applications
    url: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps
quiz:
  - question: What should the BFF not contain?
    options:
      - Session handling
      - Calls to several services for one screen
      - Business rules such as how discounts are computed
      - Response shaping for the React app
    answer: 2
    explanation: Business rules belong to the services that own the data. A BFF that grows rules becomes a second, hidden backend.
---

## Beginner

When a screen needs data from several backend services, the React app would have to
call each of them, wait, and combine the answers. A **BFF** does that work on the
server instead:

- The app makes **one** request: `GET /bff/order-page/42`.
- The BFF calls Orders, Catalog and Shipping in parallel, combines the results, and
  answers.
- The BFF also handles sign-in and keeps the tokens. The browser only gets an
  HttpOnly cookie.

## Intermediate

- One BFF per kind of client (web, mobile), owned by the frontend team.
- Call backend services in parallel (`Promise.all`) with timeouts; decide per field
  what a partial failure shows.
- Token handling: the BFF runs the OpenID Connect code flow, stores tokens server-side,
  and adds them to backend calls. This keeps tokens out of reach of XSS.
- Protect against CSRF: `SameSite` cookies plus a custom header or token on mutating
  requests.

## Senior

A BFF is an anti-corruption layer for the UI: backend teams can change their APIs
while the BFF keeps the screens' contract stable. It is also a coupling point: with
many screens it grows, so keep it free of business rules and of its own database
(cache only). GraphQL gateways and tRPC routers are BFFs too; the same rules apply.

## Analogy

A personal assistant who gathers the reports you need from different departments and
hands you one summary.

## Common mistakes

- Business logic in the BFF.
- A BFF that writes to the services' databases.
- One shared BFF for web and mobile that serves neither well.

## Examples

**Fastify route that combines two services:**

```ts
app.get('/bff/order-page/:id', { preHandler: requireSession }, async (req) => {
  const headers = { authorization: `Bearer ${req.session.accessToken}` };
  const [order, recommendations] = await Promise.all([
    fetch(`${ORDERS_URL}/orders/${req.params.id}`, { headers, signal: AbortSignal.timeout(2000) }),
    fetch(`${CATALOG_URL}/recommendations?order=${req.params.id}`, {
      signal: AbortSignal.timeout(1000),
    }).catch(() => undefined), // optional: the page still works without it
  ]);
  if (!order.ok) throw httpErrors.createError(order.status);
  return {
    order: toOrderView(await order.json()),
    recommendations: recommendations?.ok ? await recommendations.json() : [],
  };
});
```
