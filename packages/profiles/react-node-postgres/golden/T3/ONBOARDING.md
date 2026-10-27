# Onboarding: Hexagonal Node service

The domain is in the middle and depends on nothing. Use cases call ports (interfaces); adapters implement them for HTTP and the database.

This guide is written for the **intermediate** level. Open the project in ArchitectureGuide to see the diagram, follow the tour, and read every concept at your level.

## The big picture

```mermaid
flowchart LR
  actor__api_client(["API client<br/><small>User / actor</small>"])
  subgraph db__database["Database"]
    subgraph schema__orders["orders"]
      tbl__orders["orders<br/><small>Table</small>"]
    end
  end
  subgraph svc__orders["Orders"]
    ctl__order_http_adapter("Order HTTP adapter<br/><small>Controller / route handler</small>")
    dom__order{{"Order<br/><small>Domain model / aggregate</small>"}}
    mw__auth_middleware("Auth middleware<br/><small>Middleware</small>")
    port__order_repository_port(("Order repository port<br/><small>Port (interface)</small>"))
    repo__order_repository_prisma[["Order repository (prisma)<br/><small>Repository / data access</small>"]]
    uc__place_order("Place order<br/><small>Use case / application service</small>")
  end
  actor__api_client -->|"calls"| svc__orders
  ctl__order_http_adapter -->|"calls"| uc__place_order
  repo__order_repository_prisma -->|"implements"| port__order_repository_port
  repo__order_repository_prisma -->|"reads"| tbl__orders
  repo__order_repository_prisma ==>|"writes"| tbl__orders
  svc__orders -->|"migrates"| schema__orders
  uc__place_order -->|"depends on"| dom__order
  uc__place_order -->|"uses port"| port__order_repository_port
```

## Tour of Hexagonal Node service

1. **The domain in the middle**: The Order domain model holds the rules and imports nothing: no ORM, no HTTP.

   Look at: Order.
2. **Ports and adapters**: The use case asks for a port (an interface). The repository adapter implements it with prisma. Tests use an in-memory adapter instead.

   Look at: Order repository port, Order repository (prisma).
3. **Entry point**: The HTTP adapter validates input and calls the use case. Other entry points (a queue, a CLI) would call the same use case.

   Look at: Order HTTP adapter, Place order.

## Patterns used

### Hexagonal architecture (ports and adapters)

The domain sits in the middle and depends on nothing. It talks to the outside through ports (interfaces) that adapters implement.

- Dependencies point inwards: adapters → application → domain. The domain imports no
  framework or ORM. Check it automatically (dependency-cruiser rule on
  `src/domain/**`).
- Use cases orchestrate: load through a port, call domain methods, save through a port,
  publish events.
- Map at the edges: request DTO → command, entity → row, entity → response. The
  mapping code is the price of independence.
- Transactions: a "unit of work" port, or a repository method that saves an aggregate
  atomically.

## Who owns which data

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.orders | svc.orders | svc.orders | svc.orders |

## Rules of the road

- `services/orders/src/domain` MUST NOT import @prisma/client, drizzle-orm, kysely, express or any adapter.
- Persistence MUST go through a node.port; node.repository implements it.
- node.route-handler MUST call a node.use-case, never a node.repository.
- Only `svc.orders` MAY write `schema.orders`. Only `svc.orders` MAY run migrations on it.

## Concepts used in this project

- **User / actor** (`gen.actor`): A person or role that uses the system (customer, admin, support agent).
- **Domain model / aggregate** (`node.domain`): Business rules and state, free of frameworks and I/O.
- **Middleware** (`node.middleware`): Runs before or after handlers: auth, validation, rate limiting, error handling.
- **Port (interface)** (`node.port`): An interface the application needs (`OrderRepository`, `PaymentGateway`).
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
- **depends on** (`depends-on`): Compile-time import of another module or package.
- **implements** (`implements`): An adapter realizes a port (interface).
- **migrates** (`migrates`): This element owns the DDL (migrations) of the schema.
- **reads** (`reads`): Reads data from a store.
- **uses port** (`uses-port`): Depends on an interface instead of a concrete implementation.
- **writes** (`writes`): Writes data to a store.
