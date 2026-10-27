## Architecture

The architecture model is in `architecture/fsd-app.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules:
- Code MUST only import from layers below its own: pages → widgets → features → entities → shared.
- Features (Cart, Checkout, Search) MUST NOT import each other.
More rules: the Invariants section of `architecture/ARCHITECTURE.md`.
After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
