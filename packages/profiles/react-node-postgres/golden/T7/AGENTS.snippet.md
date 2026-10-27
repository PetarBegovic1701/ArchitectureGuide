## Architecture

The architecture model is in `architecture/background-jobs.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules:
- Jobs MUST be enqueued in the same transaction as the data they belong to.
- Job handlers MUST be idempotent: a job can run more than once.
- Jobs that keep failing MUST move to a dead-letter queue after the last retry.
- Only `svc.shop-api` MAY write `schema.public`. Only `svc.shop-api` MAY run migrations on it.
More rules: the Invariants section of `architecture/ARCHITECTURE.md`.
After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
