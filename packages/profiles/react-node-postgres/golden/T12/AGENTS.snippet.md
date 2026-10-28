## Architecture

The architecture model is in `architecture/type-safe-monorepo.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules:
- The app MUST call the API only through the generated or typed API client.
- Request and response shapes MUST be defined once, in packages/contract, and validated on the server.
- Browser code MUST NOT import server code; it MAY import the contract package.
- Only `svc.api` MAY write `schema.public`. Only `svc.api` MAY run migrations on it.
More rules: the Invariants section of `architecture/ARCHITECTURE.md`.
After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
