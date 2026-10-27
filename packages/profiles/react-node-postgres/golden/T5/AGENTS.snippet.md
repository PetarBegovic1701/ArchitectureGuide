## Architecture

The architecture model is in `architecture/bff.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules:
- The Web app MUST call only the BFF.
- The BFF MUST NOT write any database; Orders, Catalog own their data.
- Session tokens MUST stay in the BFF; the browser gets an HttpOnly cookie.
- Only `svc.catalog-service` MAY write `schema.catalog`. Only `svc.catalog-service` MAY run migrations on it.
- Only `svc.orders-service` MAY write `schema.orders`. Only `svc.orders-service` MAY run migrations on it.
More rules: the Invariants section of `architecture/ARCHITECTURE.md`.
After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
