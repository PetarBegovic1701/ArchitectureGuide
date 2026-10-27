---
id: topic.event-loop-and-parallelism
kind: topic
title: Concurrency and parallelism in Node.js
summary: Node.js runs your JavaScript on one thread and handles many requests concurrently; real parallelism comes from worker threads, more processes and more instances.
level: beginner
tracks: [concurrency-and-parallelism, foundations]
tags: [nodejs, event-loop, scaling]
related: [topic.concurrency-control, node.service, node.worker, pg.pooler]
references:
  - title: Node.js — The event loop, timers and process.nextTick()
    url: https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick
  - title: Node.js — Don't block the event loop (or the worker pool)
    url: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop
  - title: Node.js API — Worker threads
    url: https://nodejs.org/api/worker_threads.html
  - title: PostgreSQL docs — Connection settings (max_connections)
    url: https://www.postgresql.org/docs/current/runtime-config-connection.html
quiz:
  - question: A route resizes images in plain JavaScript and takes 2 seconds. What happens to other requests to the same process?
    options:
      [
        They run in parallel,
        They wait until it finishes,
        Node starts a new thread for each,
        PostgreSQL handles them,
      ]
    answer: 1
    explanation: CPU work blocks the single JavaScript thread. Move it to a worker thread or a background worker.
  - question: 4 instances each have a pool of 25 connections. PostgreSQL allows 100 connections. What is the risk?
    options:
      [
        None,
        Connection exhaustion during deploys or with admin tools,
        Slower JavaScript,
        Lost updates,
      ]
    answer: 1
    explanation: 4 × 25 = 100 leaves no room for migrations, admin sessions or a rolling deploy that briefly runs extra instances. Use smaller pools or a pooler such as PgBouncer.
---

## Beginner

**Concurrency** means dealing with many things at once, by switching between them.
**Parallelism** means doing many things at the same moment, on several CPU cores.

Node.js runs your JavaScript on **one main thread** with an **event loop**. When your
code waits for the database or another API (`await`), Node does not sit idle: it runs
other requests and comes back when the answer arrives. That is why one Node process
can serve thousands of requests that mostly wait for I/O.

The catch: while your code _computes_ (a big loop, image resizing, PDF generation),
nothing else runs in that process. Every other request waits.

## Intermediate

Ways to get more work done:

| Tool                          | What runs in parallel                           | Use for                                        |
| ----------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| `await Promise.all([...])`    | Waiting (I/O), not computing                    | Several independent queries or API calls       |
| `worker_threads`              | JavaScript on other cores, in the same process  | CPU-heavy tasks (hashing, image work, parsing) |
| `cluster` / several processes | Whole copies of the app on one machine          | Using all cores of a server                    |
| More instances (containers)   | Copies on many machines, behind a load balancer | Scaling out                                    |
| Background worker + job queue | Work outside the request                        | Slow tasks: emails, reports, imports           |

Every process has its own memory: in-memory caches, sessions and locks are **not
shared** between instances. Keep shared state in PostgreSQL (or another shared store).

Each instance also has its own **connection pool**. Total connections =
instances × pool size (+ workers). Keep that under PostgreSQL's `max_connections`
(default 100), or put a pooler in front.

## Senior

- libuv runs network I/O on the OS's async primitives (epoll, kqueue, IOCP) and some
  work (`fs`, `dns.lookup`, `crypto.pbkdf2`, `zlib`) on a thread pool of
  `UV_THREADPOOL_SIZE` threads (default 4). Many concurrent bcrypt/pbkdf2 calls can
  saturate it.
- Measure event-loop delay (`perf_hooks.monitorEventLoopDelay`) and alert on it; it is
  the direct signal for "something blocks the loop".
- Worker threads have their own V8 isolate; pass data with `postMessage` (copied) or
  transfer `ArrayBuffer`s. Use a pool (for example Piscina) instead of creating a worker
  per request.
- Concurrency limits matter more than raw parallelism: an unbounded `Promise.all` over
  10,000 rows exhausts the DB pool. Batch or use a limiter.
- Sizing: total connections ≈ Σ(instances × pool) + workers + migrations + admin. Under
  a transaction-mode pooler (PgBouncer), app pools can be larger than the real server
  connections, but session features (session advisory locks, `SET`, `LISTEN`) do not work
  through it.

## Analogy

A waiter (the event loop) takes orders from many tables and passes them to the kitchen
(the database). One waiter can serve a full restaurant, as long as they never stop to
cook a meal themselves.

## When to use

- Use worker threads or a background worker as soon as a request does more than a few milliseconds of pure computation.
- Use several instances when one process cannot keep up, or for availability.

## Common mistakes

- Synchronous APIs in request handlers (`fs.readFileSync`, `JSON.parse` of huge bodies, `crypto.pbkdf2Sync`).
- Unbounded `Promise.all` over large lists.
- Assuming in-memory state is shared after scaling to several instances.
- Pools so large that instances × pool exceeds `max_connections`.

## Examples

**Run independent I/O concurrently:**

```ts
const [user, orders] = await Promise.all([
  db.user.findUnique({ where: { id } }),
  db.order.findMany({ where: { userId: id }, take: 20 }),
]);
```

**Move CPU work to a worker thread:**

```ts
// hash-worker.ts: runs on another thread
import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';

parentPort!.postMessage(
  createHash('sha256')
    .update(workerData as Buffer)
    .digest('hex'),
);

// in the service
import { Worker } from 'node:worker_threads';

export function hashInWorker(data: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    // One worker per call keeps each answer with its own request.
    // In production, use a worker pool (for example Piscina) instead.
    const worker = new Worker(new URL('./hash-worker.js', import.meta.url), { workerData: data });
    worker.once('message', resolve);
    worker.once('error', reject);
  });
}
```
