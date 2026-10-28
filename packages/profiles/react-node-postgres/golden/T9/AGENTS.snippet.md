## Architecture

The architecture model is in `architecture/cqrs-lite.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules:
- Queries MUST read only the read models (Order summary, Sales by day); commands MUST write only the write tables.
- Only the projector MAY write the read models.
- Read models MAY lag behind the write tables; screens MUST NOT assume read-your-own-writes.
More rules: the Invariants section of `architecture/ARCHITECTURE.md`.
After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
