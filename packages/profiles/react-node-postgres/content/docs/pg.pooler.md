---
id: pg.pooler
kind: concept
title: Connection pooler (PgBouncer)
summary: Shares a small number of real database connections between many app instances, so scaling out the API does not exhaust the database.
level: intermediate
tracks: [concurrency-and-parallelism]
tags: [pgbouncer, rds-proxy, connections, pool]
related: [connects-via, pg.cluster, node.service, topic.event-loop-and-parallelism]
references:
  - title: PgBouncer — Features and pooling modes
    url: https://www.pgbouncer.org/features.html
  - title: PostgreSQL docs — max_connections
    url: https://www.postgresql.org/docs/current/runtime-config-connection.html
---

## Beginner

Each database connection costs memory on the PostgreSQL server, and the server allows
only a limited number. If 20 API instances each keep 20 connections, that is 400 — more
than many servers allow.

A **pooler** (PgBouncer, RDS Proxy, Supavisor) sits in between: apps connect to it, and it
shares a few real connections between them.

## Intermediate

- **Transaction mode** gives a real connection to a client only for one transaction. It
  is the most efficient, but session features (session-level `SET`, advisory locks held
  across transactions, `LISTEN`) do not work through it.
- **Session mode** keeps the connection for the whole client session.
- Keep each app's own pool small when a pooler is in front.

## Senior

- Budget: sum of (instances × pool size) across services ≤ pooler client limit; pooler
  server connections ≤ `max_connections` minus admin headroom. RNP-007 and RNP-020 check
  parts of this.
- Prepared statements need care in transaction mode (supported in newer PgBouncer).
- Serverless functions almost always need a pooler or a data API.

## Common mistakes

- Using session features through a transaction-mode pooler.
- Large app pools behind a pooler, multiplying idle connections.

## Examples

**PgBouncer in transaction mode:**

```bash
[databases]
shop = host=db.internal dbname=shop

[pgbouncer]
pool_mode = transaction
max_client_conn = 2000
default_pool_size = 40
```
