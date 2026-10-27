## Architecture

The architecture model is in `architecture/starter.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules:
- The Shop React app MUST NOT connect to PostgreSQL; it calls Shop API over HTTP.
- Only Shop API MAY write and migrate the "public" schema of Shop DB.
- Auth tokens MUST live in an HttpOnly cookie, not in localStorage.
- Only `svc.shop-api` MAY write `schema.public`. Only `svc.shop-api` MAY run migrations on it.
More rules: the Invariants section of `architecture/ARCHITECTURE.md`.
After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
