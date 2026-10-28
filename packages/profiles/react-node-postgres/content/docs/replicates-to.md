---
id: replicates-to
kind: relation
title: replicates to
summary: A database sends its changes to a replica — physical streaming or logical replication.
level: senior
tracks: [data-and-models]
tags: [replication, replicas]
related: [pg.replica, pg.database]
references:
  - title: PostgreSQL docs — Logical replication
    url: https://www.postgresql.org/docs/current/logical-replication.html
---

## Beginner

`Database replicates to Replica` means every change on the primary is copied to the
replica, usually within milliseconds.

## Intermediate

- Physical replication copies the whole server; logical replication copies chosen tables.
- Replicas lag; read-your-writes needs the primary.

## Senior

- Logical replication can feed analytics or search without dual writes.

## Common mistakes

- Treating replication as a backup.

## Examples

**Create a publication for logical replication:**

```sql
CREATE PUBLICATION orders_pub FOR TABLE orders, order_items;
```
