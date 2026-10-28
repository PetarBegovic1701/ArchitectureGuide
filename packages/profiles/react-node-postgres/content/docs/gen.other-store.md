---
id: gen.other-store
kind: concept
title: Other data store
summary: A data store outside this stack profile — Redis, S3, MongoDB, Elasticsearch. Only the generic rules apply to it.
level: intermediate
tracks: [data-and-models]
tags: [redis, s3, cache, storage]
related: [reads, writes, pg.database]
references:
  - title: Redis — Documentation
    url: https://redis.io/docs/latest/
  - title: AWS — What is Amazon S3?
    url: https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html
---

## Beginner

Not everything belongs in PostgreSQL. **Redis** keeps sessions and caches in memory,
**S3** stores files like product images, a search engine indexes text. Use this shape for
them; this tool applies only its generic rules to it.

## Intermediate

- A cache is a copy: decide how it is invalidated and what happens when it is empty.
- Files go to object storage; the database keeps the key and metadata.
- Every extra store is another thing to back up, secure and monitor.

## Senior

- Writing to two stores (Postgres and a search index) is a dual write (RNP-007): use an
  outbox or change data capture to keep them consistent.
- Prefer Postgres features (JSONB, full-text search, `pg_trgm`) until a separate store is
  clearly needed.

## Common mistakes

- Using a cache as the source of truth.
- Dual writes without an outbox.

## Examples

**Cache-aside with Redis:**

```ts
const cached = await redis.get(`product:${id}`);
if (cached) return JSON.parse(cached);
const product = await products.findById(id);
await redis.set(`product:${id}`, JSON.stringify(product), { EX: 300 });
return product;
```
