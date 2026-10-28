---
id: pg.cluster
kind: concept
title: Postgres server (instance)
summary: One running PostgreSQL server. It holds one or more databases and has limits that every app shares — connections, memory, CPU.
level: intermediate
tracks: [data-and-models, concurrency-and-parallelism]
tags: [postgres, rds, neon, supabase, hosting]
related: [pg.database, pg.replica, pg.pooler]
references:
  - title: PostgreSQL docs — Creating a database cluster
    url: https://www.postgresql.org/docs/current/creating-cluster.html
  - title: PostgreSQL docs — Connections and authentication (max_connections)
    url: https://www.postgresql.org/docs/current/runtime-config-connection.html
---

## Beginner

A **Postgres server** (PostgreSQL calls it a cluster) is one running database program on
one machine or managed service. It can hold several **databases**.

Everything on the same server shares its resources: if one app opens too many
connections or runs a huge report, the others feel it.

## Intermediate

- Managed hosting (RDS, Cloud SQL, Neon, Supabase) handles backups, upgrades and
  failover; you still own schema design and queries.
- `max_connections` is a hard limit for all apps together; each Node instance's pool
  counts against it.
- A primary server takes writes; **read replicas** can serve read-only queries.

## Senior

- Size by working set (data that must fit in memory) and write volume, not disk size.
- Plan failover: what happens to in-flight transactions and to connection strings.
- Separate noisy workloads (analytics) onto replicas or another server.

## Common mistakes

- Many services each with a large pool on one small server.
- No tested restore from backup.

## Examples

**Check how close you are to the connection limit:**

```sql
SELECT count(*) AS used, current_setting('max_connections')::int AS max
FROM pg_stat_activity;
```
