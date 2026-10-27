## Architecture

The architecture model is in `architecture/db-per-service.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules:
- Each of Orders, Payments, Shipping MUST only connect to its own database.
- Services MUST NOT call each other in a cycle; follow-up work goes through the job queue.
- All external traffic MUST pass the gateway, which checks tokens.
- Only `svc.orders-service` MAY write `db.orders-db`. Only `svc.orders-service` MAY run migrations on it.
- Only `svc.payments-service` MAY write `db.payments-db`. Only `svc.payments-service` MAY run migrations on it.
- Only `svc.shipping-service` MAY write `db.shipping-db`. Only `svc.shipping-service` MAY run migrations on it.
More rules: the Invariants section of `architecture/ARCHITECTURE.md`.
After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
