---
id: pattern.starter
kind: pattern
title: 'Starter: React app, Node API, PostgreSQL'
summary: The smallest complete web application. A React app in the browser, one Node.js API, and one PostgreSQL database that only the API touches.
level: beginner
tracks: [foundations, patterns]
tags: [full-stack, rest, prisma]
related:
  [
    react.app,
    node.service,
    pg.schema,
    migrates,
    topic.authentication,
    topic.models,
    pattern.layered,
  ]
references:
  - title: React — Quick Start
    url: https://react.dev/learn
  - title: Express — Routing
    url: https://expressjs.com/en/guide/routing.html
  - title: Prisma — Prisma Migrate
    url: https://www.prisma.io/docs/orm/prisma-migrate
  - title: The Twelve-Factor App
    url: https://12factor.net/
quiz:
  - question: Why does the React app call the API instead of querying PostgreSQL itself?
    options:
      - Browsers cannot send SQL
      - Code in the browser is public, so database credentials and checks would be public too
      - PostgreSQL only accepts connections from Node.js
      - It is faster
    answer: 1
    explanation: Anyone can read and change code that runs in the browser. The API keeps the credentials secret and checks every request on the server.
---

## Beginner

Three parts, each with one job:

- **React app** (runs in the browser): shows screens and sends requests.
- **Node.js API** (runs on a server): checks who is calling, applies the business
  rules, and reads and writes data.
- **PostgreSQL** (the database): stores the data safely.

The browser never talks to the database. It sends `POST /api/orders` to the API; the
API checks the session, validates the input, writes rows in one transaction, and
answers with JSON.

One component owns the database schema: the API runs the migrations (the scripts that
create and change tables). Nobody else changes the tables.

## Intermediate

- Keep the API **stateless**: sessions live in a cookie plus a session table, not in
  process memory, so you can run two instances later.
- Configuration comes from environment variables (`DATABASE_URL`, `SESSION_SECRET`),
  never from the code (Twelve-Factor).
- Validate every request at the API boundary (zod), and share the request and response
  types with React through a small shared package.
- Migrations run in CI or at deploy time, before the new API version starts.

## Senior

This shape scales further than most teams expect: add modules inside the API, read
replicas, a job queue and a CDN before you add services. The decisions that are hard
to undo are the data model and the API contract, not the number of processes. Watch
for the API growing without internal boundaries; apply the layered or modular-monolith
templates inside it when it does.

## Analogy

A restaurant: guests (browser) order from the waiter (API), and only the kitchen staff
(API code) go into the storeroom (database).

## Common mistakes

- Putting the database URL in a `VITE_` variable: it ends up in the browser bundle.
- Checking permissions only by hiding buttons in React.
- Two apps running migrations on the same schema.

## Examples

**An Express route with validation and a transaction (Prisma):**

```ts
const PlaceOrder = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

app.post('/api/orders', requireUser, async (req, res) => {
  const input = PlaceOrder.parse(req.body);
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({ data: { customerId: req.user.id, ...input } });
    await tx.auditLog.create({ data: { action: 'order.placed', orderId: created.id } });
    return created;
  });
  res.status(201).json({ id: order.id });
});
```
