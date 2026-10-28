---
id: pg.database
kind: concept
title: Database
summary: A PostgreSQL database — the place where data survives restarts. Only backend code connects to it; schemas inside it group tables by owner.
level: beginner
tracks: [foundations, data-and-models]
tags: [postgres, postgresql, sql]
related: [pg.schema, pg.table, node.service, pattern.database-per-service, reads, writes]
references:
  - title: PostgreSQL docs — Tutorial
    url: https://www.postgresql.org/docs/current/tutorial.html
  - title: PostgreSQL docs — Managing databases
    url: https://www.postgresql.org/docs/current/managing-databases.html
quiz:
  - question: Why can the React app not connect to PostgreSQL directly?
    options:
      [
        Browsers cannot speak SQL fast enough,
        The database credentials would be public and anyone could run any query,
        PostgreSQL blocks browsers by IP,
        It can if you use HTTPS,
      ]
    answer: 1
    explanation: Everything in the browser is public. The API holds the credentials, checks every request and only runs the queries it allows.
---

## Beginner

The **database** keeps your data safe: orders, users, products. When servers restart, the
data is still there.

Only the backend (the API, workers) connects to it. The browser never does: the
connection needs a password, and everything in the browser is public.

Inside a database, **schemas** group tables, and **tables** hold rows.

## Intermediate

- Use transactions for changes that belong together.
- Run schema changes as **migrations** owned by one service.
- Back up regularly and test restores.
- One database can serve several services if each owns its own schema; or each service
  gets its own database (database per service).

## Senior

- A shared database is the strongest coupling between services; make ownership explicit
  per schema and enforce it with database roles.
- Connection budget, vacuum, and index health are operational duties, not afterthoughts.
- Use constraints (foreign keys, `CHECK`, unique) as the last line of defense for data
  rules.

## Analogy

The database is the vault of a bank. Only clerks (backend code) with the key go in, and
only to do what the rules allow.

## Common mistakes

- Connecting from the browser or a mobile app.
- Two services writing the same tables without an owner.
- No constraints, so bad data slips in through a bug.

## Examples

**Create a database and a role that owns it:**

```sql
CREATE ROLE shop_app LOGIN PASSWORD 'change-me';
CREATE DATABASE shop OWNER shop_app;
```
