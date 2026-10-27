# Onboarding: Layered Node API

Each entity gets a route handler, a use case and a repository. Requests go down the layers, never around them.

This guide is written for the **intermediate** level. Open the project in ArchitectureGuide to see the diagram, follow the tour, and read every concept at your level.

## The big picture

```mermaid
flowchart LR
  actor__api_client(["API client<br/><small>User / actor</small>"])
  subgraph db__database["Database"]
    subgraph schema__app["app"]
      tbl__customers["customers<br/><small>Table</small>"]
      tbl__orders["orders<br/><small>Table</small>"]
    end
  end
  subgraph svc__orders_api["Orders API"]
    ctl__customer_routes("Customer routes<br/><small>Controller / route handler</small>")
    ctl__order_routes("Order routes<br/><small>Controller / route handler</small>")
    mw__auth_middleware("Auth middleware<br/><small>Middleware</small>")
    repo__customer_repository[["Customer repository<br/><small>Repository / data access</small>"]]
    repo__order_repository[["Order repository<br/><small>Repository / data access</small>"]]
    uc__customer_service("Customer service<br/><small>Use case / application service</small>")
    uc__order_service("Order service<br/><small>Use case / application service</small>")
  end
  actor__api_client -->|"calls"| svc__orders_api
  ctl__customer_routes -->|"calls"| uc__customer_service
  ctl__order_routes -->|"calls"| uc__order_service
  repo__customer_repository -->|"reads"| tbl__customers
  repo__customer_repository ==>|"writes"| tbl__customers
  repo__order_repository -->|"reads"| tbl__orders
  repo__order_repository ==>|"writes"| tbl__orders
  svc__orders_api -->|"migrates"| schema__app
  uc__customer_service -->|"calls"| repo__customer_repository
  uc__order_service -->|"calls"| repo__order_repository
```

## Tour of Layered Node API

1. **Three layers**: Route handlers turn HTTP into calls, use cases hold the rules, repositories talk to the database.

   Look at: Order routes, Order service, Order repository.
2. **One way down**: A request goes handler → use case → repository → table. A handler that queries the database itself skips the rules (RNP-005).
3. **Tables per entity**: Each of Order, Customer has its own table and its own repository, so database code for one entity lives in one place.

   Look at: app.

## Patterns used

### Layered architecture

Code is split into presentation, application and data-access layers. Each layer calls only the layer below it.

- Handlers stay thin: no queries, no rules. If a handler is longer than the use case it
  calls, rules are leaking upwards.
- One repository per entity (or per aggregate). Use cases can call several
  repositories inside one transaction; pass the transaction down.
- Errors travel up as typed results or domain errors (`OrderNotFound`), and only the
  handler maps them to HTTP status codes.
- Test use cases with fake repositories; test repositories against a real PostgreSQL
  (Testcontainers or a test database).

## Who owns which data

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.app | svc.orders-api | svc.orders-api | svc.orders-api |

## Rules of the road

- A node.route-handler in Orders API MUST call a node.use-case, never a repository or the database.
- Only node.repository code MAY import the database client.
- Each of Order, Customer has exactly one repository.
- Only `svc.orders-api` MAY write `schema.app`. Only `svc.orders-api` MAY run migrations on it.

## Concepts used in this project

- **User / actor** (`gen.actor`): A person or role that uses the system (customer, admin, support agent).
- **Middleware** (`node.middleware`): Runs before or after handlers: auth, validation, rate limiting, error handling.
- **Repository / data access** (`node.repository`): Reads and writes the database through an ORM or query builder.
- **Controller / route handler** (`node.route-handler`): Receives HTTP requests: an Express router, Fastify routes or a NestJS controller.
- **Node service** (`node.service`): A Node.js process that serves requests (Express, Fastify or NestJS).
- **Use case / application service** (`node.use-case`): One application action (`PlaceOrder`).
- **Database** (`pg.database`): A PostgreSQL database.
- **Schema** (`pg.schema`): A namespace of tables.
- **Table** (`pg.table`): Tables store your data; keys, constraints and indexes keep it correct and fast.

  - **Normalize first:** store each fact once (the customer's email lives in `customers`,
    not copied into every order). Denormalize later, on purpose, for read speed.
  - **Keys:** `bigint GENERATED ALWAYS AS IDENTITY` is simple and compact; UUIDs (v7 sorts by
    time) help when IDs are created outside the database or must not be guessable.
  - **Foreign keys:** choose `ON DELETE` on purpose: `RESTRICT` (default, safest),
    `CASCADE` (delete children), `SET NULL`.
  - **Index foreign key columns** you join or filter on; PostgreSQL does not do it for you.
  - **Types:** `timestamptz` for points in time, `numeric` or integer cents for money,
    `text` with a `CHECK` (or an enum) for statuses, `jsonb` only for truly flexible data.
  - One service owns the migrations of a schema. Other services read through an API or a view.
- **calls** (`calls`): Synchronous request/response.
- **migrates** (`migrates`): This element owns the DDL (migrations) of the schema.
- **reads** (`reads`): Reads data from a store.
- **writes** (`writes`): Writes data to a store.
