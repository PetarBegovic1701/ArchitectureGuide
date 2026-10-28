---
id: pg.replica
kind: concept
title: Read replica
summary: A read-only copy of a database that follows the primary. It takes reports and read traffic off the primary, a little behind in time.
level: senior
tracks: [data-and-models, concurrency-and-parallelism]
tags: [postgres, replication, scaling]
related: [pg.database, replicates-to, pg.view]
references:
  - title: PostgreSQL docs — High availability, load balancing and replication
    url: https://www.postgresql.org/docs/current/high-availability.html
---

## Beginner

A **read replica** is a copy of the database that only allows reading. The primary sends
it every change. Heavy reads — reports, exports, search — can run there without slowing
down checkouts on the primary.

## Intermediate

- Replicas lag behind (usually milliseconds, sometimes seconds). A user who just saved
  something may not see it on a replica yet: read your own writes from the primary.
- Writes to a replica fail; this tool refuses `writes` to a replica.
- Replicas also serve as standbys for failover.

## Senior

- Route reads deliberately (per query or per endpoint), not "all GETs to the replica".
- Long queries on a replica can conflict with replication (`hot_standby_feedback`,
  `max_standby_streaming_delay` trade-offs).
- Logical replication can feed other systems (search, analytics).

## Common mistakes

- Reading just-written data from a lagging replica.
- Treating a replica as a backup (deletes replicate too).

## Examples

**Check replication lag on a replica:**

```sql
SELECT now() - pg_last_xact_replay_timestamp() AS lag;
```
