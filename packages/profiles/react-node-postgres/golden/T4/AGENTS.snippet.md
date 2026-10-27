## Architecture

The architecture model is in `architecture/modular-monolith.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules:
- Each of Orders, Catalog, Billing MUST only write its own schema.
- A module MUST use another module only through its exported service, never its repositories or tables.
- Only `svc.shop` MAY write `schema.billing`. Only `svc.shop` MAY run migrations on it.
- Only `svc.shop` MAY write `schema.catalog`. Only `svc.shop` MAY run migrations on it.
- Only `svc.shop` MAY write `schema.orders`. Only `svc.shop` MAY run migrations on it.
More rules: the Invariants section of `architecture/ARCHITECTURE.md`.
After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
