---
id: pattern.multi-tenant
kind: pattern
title: Multi-tenant SaaS on PostgreSQL
summary: Many customer organizations share one deployment; each request is tied to a tenant, and PostgreSQL keeps tenants apart with row-level security or one schema per tenant.
level: senior
tracks: [patterns, auth, data-and-models]
tags: [multi-tenancy, row-level-security, rls, search-path, saas]
related: [pg.schema, node.middleware, topic.authentication, pg.table, pattern.database-per-service]
references:
  - title: PostgreSQL docs — Row security policies
    url: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
  - title: AWS — Multi-tenant data isolation with PostgreSQL row level security
    url: https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/
  - title: PostgreSQL docs — Schemas and the search path
    url: https://www.postgresql.org/docs/current/ddl-schemas.html
quiz:
  - question: Why let the database enforce tenant isolation instead of adding WHERE tenant_id = ... in every query?
    options:
      - It is faster
      - One forgotten WHERE clause would leak another tenant's data; a policy cannot be forgotten
      - ORMs cannot write WHERE clauses
      - It is required by law
    answer: 1
    explanation: With row-level security the database filters every query by the tenant set for the transaction, so a missing filter in code does not leak data.
---

## Beginner

A SaaS product serves many customer organizations — **tenants** — from one
deployment. The most important rule: a tenant must never see another tenant's data.

Every request is first tied to a tenant (from the logged-in user). Then the database
keeps tenants apart, in one of two ways:

- **Row-level security (rls):** all tenants share the tables; every row has a
  `tenant_id`, and a policy lets each transaction see only its tenant's rows.
- **Schema per tenant:** each tenant gets its own copy of the schema; the request
  switches to it.

## Intermediate

- Set the tenant per transaction: `SET LOCAL app.tenant_id = '…'` (rls) or
  `SET LOCAL search_path = tenant_acme` (schema per tenant). With a connection pool,
  never set it per session.
- The application's database role must not own the tables and must not have
  `BYPASSRLS`, or the policies do not apply.
- Index `tenant_id` first in composite indexes.
- Background jobs carry the tenant ID in their payload and set it before touching data.
- Keep shared data (plans, tenants, users) in a separate control schema.

## Senior

rls scales to many small tenants with simple migrations; schema-per-tenant gives
stronger separation, per-tenant restore and per-tenant customization, but migrations
run N times and the catalog grows with tenants (thousands of schemas strain tools).
Large or regulated tenants may need their own database — a hybrid is common. Test
isolation explicitly: a test that runs as tenant A must never read tenant B's rows.

## Analogy

An apartment building: everyone shares the structure, but each key opens only one
apartment. Row-level security is the lock on each door, not a sign asking people to
stay out.

## Common mistakes

- Relying only on WHERE clauses in application code.
- Setting the tenant on a pooled connection for the session instead of the transaction.
- Running the app as the table owner (policies are skipped).
- Jobs without a tenant ID.

## Examples

**A row-level security policy for one table:**

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

**Set the tenant for one transaction:**

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  return tx.project.findMany();
});
```
