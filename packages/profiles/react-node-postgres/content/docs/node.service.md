---
id: node.service
kind: concept
title: Node service (API)
summary: A Node.js process that answers requests. It checks who is calling, validates input, applies business rules, and is the only part that talks to the database.
level: beginner
tracks: [foundations, concurrency-and-parallelism]
tags: [express, fastify, nestjs, backend]
related:
  [
    node.route-handler,
    node.use-case,
    node.repository,
    topic.event-loop-and-parallelism,
    pg.schema,
    calls,
  ]
references:
  - title: Node.js — Introduction
    url: https://nodejs.org/en/learn/getting-started/introduction-to-nodejs
  - title: Fastify — Getting started
    url: https://fastify.dev/docs/latest/Guides/Getting-Started/
  - title: Express — Hello world
    url: https://expressjs.com/en/starter/hello-world.html
quiz:
  - question: Why must the API validate a request even if the React app already checked the form?
    options:
      [
        It does not need to,
        Requests can come from anywhere — scripts and other clients included,
        Browsers are slow,
        Validation is only for TypeScript,
      ]
    answer: 1
    explanation: Anyone can send HTTP requests to your API without your frontend. The server is the only place where checks are enforced.
---

## Beginner

The **API** (a Node service) is the part of the system that runs on your servers. The
browser sends it requests (`POST /api/orders`); it answers with data (JSON).

It has three jobs the browser cannot do safely:

1. **Check who is calling** and what they may do.
2. **Validate** every request, because requests can come from anywhere.
3. **Read and write the database**, applying the business rules (prices, stock, limits).

Frameworks: Express (small, popular), Fastify (fast, schema-based), NestJS (structured,
with modules and dependency injection).

## Intermediate

- Inside a service you usually find **route handlers** (HTTP in and out), **use cases**
  (one business action each) and **repositories** (database access).
- Configure it with environment variables; keep secrets out of the code.
- Run several **instances** behind a load balancer for availability; each has its own
  database **connection pool**.
- Return clear errors: 400 for bad input, 401/403 for auth, 404, 409 for conflicts.

## Senior

- One Node process runs JavaScript on one thread: CPU-heavy work (image processing, big
  JSON, crypto loops) blocks every other request. Move it to worker threads or a
  background worker.
- `instances × poolSize` must stay below the database's `max_connections`, or use a
  pooler.
- Stateless instances (sessions in a store or a cookie) scale horizontally; in-memory
  state does not survive a restart or a second instance.
- Graceful shutdown: stop accepting, finish in-flight requests, close the pool.

## Analogy

The API is the bank clerk: it checks your ID, checks the request makes sense, and only
then goes to the vault (database). Customers never enter the vault themselves.

## Common mistakes

- Trusting data from the browser.
- Business rules spread across route handlers.
- CPU-heavy work on the request path.
- Too many connections: instances × pool size above the database limit.

## Examples

**A minimal Fastify service with validation:**

```ts
import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.post(
  '/orders',
  {
    schema: {
      body: {
        type: 'object',
        required: ['productId', 'quantity'],
        properties: { productId: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } },
      },
    },
  },
  async (req, reply) => reply.code(201).send({ id: 'ord_1' }),
);

await app.listen({ port: 3000 });
```
