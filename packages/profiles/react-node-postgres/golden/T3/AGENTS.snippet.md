## Architecture

The architecture model is in `architecture/hexagonal-service.archguide.json`; read `architecture/ARCHITECTURE.md` before you plan changes.
Rules:
- `services/orders/src/domain` MUST NOT import @prisma/client, drizzle-orm, kysely, express or any adapter.
- Persistence MUST go through a node.port; node.repository implements it.
- node.route-handler MUST call a node.use-case, never a node.repository.
- Only `svc.orders` MAY write `schema.orders`. Only `svc.orders` MAY run migrations on it.
More rules: the Invariants section of `architecture/ARCHITECTURE.md`.
After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.
