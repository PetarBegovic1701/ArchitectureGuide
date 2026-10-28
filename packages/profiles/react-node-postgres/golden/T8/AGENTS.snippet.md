## Architecture

The architecture model is in `architecture/outbox.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules:
- Orders MUST write its data and the outbox row in one transaction; it MUST NOT publish directly.
- Only the outbox relay MAY publish the events (order.placed, order.paid); it marks rows as sent after publishing.
- Consumers MUST be idempotent: the relay delivers each event at least once.
More rules: the Invariants section of `architecture/ARCHITECTURE.md`.
After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
