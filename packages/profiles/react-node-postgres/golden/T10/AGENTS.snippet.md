## Architecture

The architecture model is in `architecture/realtime.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules:
- NOTIFY messages MUST only signal that something changed; clients MUST reload the data through the API.
- Work that must not be lost MUST go through the job queue, not NOTIFY.
- The realtime gateway MUST authenticate every connection.
- Only `svc.orders-api` MAY write `schema.public`. Only `svc.orders-api` MAY run migrations on it.
More rules: the Invariants section of `architecture/ARCHITECTURE.md`.
After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
