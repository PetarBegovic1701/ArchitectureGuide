---
archguide: 1
project: fsd-app
profile: react-node-postgres
patterns: [fsd-app]
revision: 0
generated: 2026-10-27
---

# Architecture: Feature-Sliced React app

The React code is split into layers (pages, widgets, features, entities, shared) and slices. Code only imports from layers below it.

## Elements

| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |
|---|---|---|---|---|---|---|---|
| apic.api-client | react.api-client | API client | app.web | presentation | – | – | – |
| app.web | react.app | Web | – | presentation | – | – | – |
| feat.cart | react.feature | Cart | layer.features | presentation | – | – | src/** |
| feat.checkout | react.feature | Checkout | layer.features | presentation | – | – | src/** |
| feat.home-page | react.feature | Home page | layer.pages | presentation | – | – | src/** |
| feat.product | react.feature | Product | layer.entities | presentation | – | – | src/** |
| feat.search | react.feature | Search | layer.features | presentation | – | – | src/** |
| feat.storefront | react.feature | Storefront | layer.widgets | presentation | – | – | src/** |
| feat.ui-kit | react.feature | UI kit | layer.shared | presentation | – | – | src/** |
| feat.user | react.feature | User | layer.entities | presentation | – | – | src/** |
| qcache.server-state-cache | react.server-state | Server-state cache | app.web | presentation | – | – | – |
| layer.entities | group.layer | entities | app.web | – | – | – | – |
| layer.features | group.layer | features | app.web | – | – | – | – |
| layer.pages | group.layer | pages | app.web | – | – | – | – |
| layer.shared | group.layer | shared | app.web | – | – | – | – |
| layer.widgets | group.layer | widgets | app.web | – | – | – | – |

## Relations

| From | Relation | To | Details |
|---|---|---|---|
| feat.cart | depends-on | feat.user | – |
| feat.checkout | depends-on | feat.product | – |
| feat.home-page | depends-on | feat.storefront | – |
| feat.product | depends-on | feat.ui-kit | – |
| feat.product | fetches-via | apic.api-client | – |
| feat.product | uses-state | qcache.server-state-cache | – |
| feat.search | depends-on | feat.user | – |
| feat.storefront | depends-on | feat.cart | – |
| feat.storefront | depends-on | feat.checkout | – |
| feat.storefront | depends-on | feat.search | – |
| feat.user | depends-on | feat.ui-kit | – |
| feat.user | fetches-via | apic.api-client | – |

## Invariants

- Code MUST only import from layers below its own: pages → widgets → features → entities → shared. (T11)
- Features (Cart, Checkout, Search) MUST NOT import each other. (T11)
- Browser code MUST NOT read or write a database directly. (AP-002)
- Modules MUST NOT depend on each other in a cycle. (AP-003)
- Services MUST NOT call each other synchronously in a cycle. (AP-006)
- Synchronous call chains between services MUST stay at most 4 services long. (AP-007)
- The React app MUST call at most 2 Node services directly; use a BFF beyond that. (RNP-011)
- Feature-Sliced code MUST only import from layers below its own. (RNP-013)
- Features MUST NOT import other features. (RNP-014)
- Auth tokens MUST NOT be stored in localStorage or sessionStorage. (RNP-026)

## Concepts

- **Layer** (`group.layer`): A horizontal layer such as presentation, application, domain or infrastructure.
- **API client** (`react.api-client`): The layer that talks to the backend: a fetch wrapper, axios, a generated OpenAPI client, or tRPC.
- **React app** (`react.app`): A React single-page app built with Vite.
- **Feature module** (`react.feature`): A folder that holds one feature: its components, hooks and state (for example `src/features/cart`).
- **Server-state cache** (`react.server-state`): Data that belongs to the server (orders, users) needs caching and refetching; data that belongs to the UI (open dialogs, drafts) needs a simple store. Mixing them causes stale screens.
- **depends on** (`depends-on`): Compile-time import of another module or package.
- **fetches via** (`fetches-via`): Loads data through the API client.
- **uses state** (`uses-state`): Reads or updates a client store or a server-state cache.
