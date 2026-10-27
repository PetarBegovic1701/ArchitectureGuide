# Onboarding: React + Node backend-for-frontend

The React app talks to one Node BFF. The BFF holds the session, combines calls to the backend services, and shapes data for the screens.

This guide is written for the **intermediate** level. Open the project in ArchitectureGuide to see the diagram, follow the tour, and read every concept at your level.

## The big picture

```mermaid
flowchart LR
  actor__customer(["Customer<br/><small>User / actor</small>"])
  app__web["Web<br/><small>React app</small>"]
  subgraph bff__web_bff["Web BFF"]
    mw__auth_middleware("Auth middleware<br/><small>Middleware</small>")
  end
  subgraph db__services_db["Services DB"]
    schema__catalog[("catalog<br/><small>Schema</small>")]
    schema__orders[("orders<br/><small>Schema</small>")]
  end
  svc__catalog_service["Catalog service<br/><small>Node service</small>"]
  svc__orders_service["Orders service<br/><small>Node service</small>"]
  actor__customer -->|"calls: uses"| app__web
  app__web -->|"calls: one call per screen"| bff__web_bff
  bff__web_bff -->|"calls"| svc__catalog_service
  bff__web_bff -->|"calls"| svc__orders_service
  svc__catalog_service -->|"migrates"| schema__catalog
  svc__catalog_service -->|"reads"| schema__catalog
  svc__catalog_service ==>|"writes"| schema__catalog
  svc__orders_service -->|"migrates"| schema__orders
  svc__orders_service -->|"reads"| schema__orders
  svc__orders_service ==>|"writes"| schema__orders
```

## Tour of React + Node backend-for-frontend

1. **One door for the app**: The Web app only knows its BFF. It makes one request per screen.

   Look at: Web, Web BFF.
2. **The BFF holds the session**: The browser gets an HttpOnly cookie; the BFF keeps the tokens and checks them in its auth middleware.

   Look at: Auth middleware.
3. **Services own their data**: Each of Orders, Catalog has its own schema. The BFF reads nothing directly; it calls the services.

   Look at: Services DB.

## Patterns used

### Backend-for-frontend (BFF)

A small Node service made for one frontend. It holds the session, calls the backend services, and returns exactly the data each screen needs.

- One BFF per kind of client (web, mobile), owned by the frontend team.
- Call backend services in parallel (`Promise.all`) with timeouts; decide per field
  what a partial failure shows.
- Token handling: the BFF runs the OpenID Connect code flow, stores tokens server-side,
  and adds them to backend calls. This keeps tokens out of reach of XSS.
- Protect against CSRF: `SameSite` cookies plus a custom header or token on mutating
  requests.

## Who owns which data

| Store | Owner (migrations) | Writers | Readers |
|---|---|---|---|
| schema.catalog | svc.catalog-service | svc.catalog-service | svc.catalog-service |
| schema.orders | svc.orders-service | svc.orders-service | svc.orders-service |

## Rules of the road

- The Web app MUST call only the BFF.
- The BFF MUST NOT write any database; Orders, Catalog own their data.
- Session tokens MUST stay in the BFF; the browser gets an HttpOnly cookie.
- Only `svc.catalog-service` MAY write `schema.catalog`. Only `svc.catalog-service` MAY run migrations on it.
- Only `svc.orders-service` MAY write `schema.orders`. Only `svc.orders-service` MAY run migrations on it.

## Concepts used in this project

- **User / actor** (`gen.actor`): A person or role that uses the system (customer, admin, support agent).
- **Backend-for-Frontend** (`node.bff`): A Node service made for one frontend.
- **Middleware** (`node.middleware`): Runs before or after handlers: auth, validation, rate limiting, error handling.
- **Node service** (`node.service`): A Node.js process that serves requests (Express, Fastify or NestJS).
- **Database** (`pg.database`): A PostgreSQL database.
- **Schema** (`pg.schema`): A namespace of tables.
- **React app** (`react.app`): A React single-page app built with Vite.
- **calls** (`calls`): Synchronous request/response.
- **migrates** (`migrates`): This element owns the DDL (migrations) of the schema.
- **reads** (`reads`): Reads data from a store.
- **writes** (`writes`): Writes data to a store.
