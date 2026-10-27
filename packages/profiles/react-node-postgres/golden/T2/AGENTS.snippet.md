## Architecture

The architecture model is in `architecture/layered-api.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules:
- A node.route-handler in Orders API MUST call a node.use-case, never a repository or the database.
- Only node.repository code MAY import the database client.
- Each of Order, Customer has exactly one repository.
- Only `svc.orders-api` MAY write `schema.app`. Only `svc.orders-api` MAY run migrations on it.
More rules: the Invariants section of `architecture/ARCHITECTURE.md`.
After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
