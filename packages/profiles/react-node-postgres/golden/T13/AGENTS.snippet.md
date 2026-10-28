## Architecture

The architecture model is in `architecture/multi-tenant.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules:
- Every request MUST be tied to exactly one tenant before it touches data.
- Tenant data MUST be isolated by the database (row-level security or one schema per tenant), not only by WHERE clauses in code.
- Background jobs MUST carry the tenant ID and set it before they touch data.
- Only `svc.saas-api` MAY write `schema.app`. Only `svc.saas-api` MAY run migrations on it.
More rules: the Invariants section of `architecture/ARCHITECTURE.md`.
After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
