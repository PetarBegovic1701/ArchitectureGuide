# Onboarding: NestJS modular monolith

One deployable split into modules. Each module owns its own schema and offers a public API; other modules never touch its tables.

This guide is written for the **intermediate** level. Open the project in ArchitectureGuide to see the diagram, follow the tour, and read every concept at your level.

## The big picture

```mermaid
flowchart LR
  actor__api_client(["API client<br/><small>User / actor</small>"])
  subgraph db__shop_db["Shop DB"]
    schema__billing[("billing<br/><small>Schema</small>")]
    schema__catalog[("catalog<br/><small>Schema</small>")]
    schema__orders[("orders<br/><small>Schema</small>")]
  end
  subgraph svc__shop["Shop"]
    mod__billing("Billing<br/><small>Module</small>")
    mod__catalog("Catalog<br/><small>Module</small>")
    mod__orders("Orders<br/><small>Module</small>")
    mw__auth_middleware("Auth middleware<br/><small>Middleware</small>")
  end
  actor__api_client -->|"calls"| svc__shop
  mod__billing -->|"depends on: public API"| mod__orders
  mod__billing ==>|"writes"| schema__billing
  mod__catalog ==>|"writes"| schema__catalog
  mod__orders -->|"depends on: public API"| mod__catalog
  mod__orders ==>|"writes"| schema__orders
  svc__shop -->|"migrates"| schema__billing
  svc__shop -->|"migrates"| schema__catalog
  svc__shop -->|"migrates"| schema__orders
```

## Tour of NestJS modular monolith

1. **One deployable, many modules**: Shop runs as one process. Inside, Orders, Catalog, Billing are separate modules with clear owners.

   Look at: Shop.
2. **Each module owns its schema**: A module reads and writes only its own schema. Reaching into another module’s tables is reported (RNP-028).

   Look at: Shop DB.
3. **Talk through public APIs**: Modules call each other through exported services, so a module can later move into its own service.

   Look at: Orders.

## Patterns used

### Modular monolith

One deployable, split into modules with clear owners. Each module owns its tables and offers a public API to the others.

- Give each module its own PostgreSQL **schema** (`orders`, `billing`). It makes
  ownership visible, and lets you grant privileges per schema later.
- In NestJS, `@Module({ exports: [...] })` defines the public API. Keep repositories
  and entities out of `exports`.
- Enforce the walls in CI: dependency-cruiser or ESLint boundaries rules that forbid
  imports from another module's internals.
- Cross-module workflows: call the other module's service, or emit an in-process event
  that the other module handles.

## Who owns which data

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.billing | svc.shop, module Billing | svc.shop | – |
| schema.catalog | svc.shop, module Catalog | svc.shop | – |
| schema.orders | svc.shop, module Orders | svc.shop | – |

## Rules of the road

- Each of Orders, Catalog, Billing MUST only write its own schema.
- A module MUST use another module only through its exported service, never its repositories or tables.
- Only `svc.shop` MAY write `schema.billing`. Only `svc.shop` MAY run migrations on it.
- Only `svc.shop` MAY write `schema.catalog`. Only `svc.shop` MAY run migrations on it.
- Only `svc.shop` MAY write `schema.orders`. Only `svc.shop` MAY run migrations on it.

## Concepts used in this project

- **User / actor** (`gen.actor`): A person or role that uses the system (customer, admin, support agent).
- **Middleware** (`node.middleware`): Runs before or after handlers: auth, validation, rate limiting, error handling.
- **Module** (`node.module`): A NestJS module or a feature folder with a public API.
- **Node service** (`node.service`): A Node.js process that serves requests (Express, Fastify or NestJS).
- **Database** (`pg.database`): A PostgreSQL database.
- **Schema** (`pg.schema`): A namespace of tables.
- **calls** (`calls`): Synchronous request/response.
- **depends on** (`depends-on`): Compile-time import of another module or package.
- **migrates** (`migrates`): This element owns the DDL (migrations) of the schema.
- **writes** (`writes`): Writes data to a store.
