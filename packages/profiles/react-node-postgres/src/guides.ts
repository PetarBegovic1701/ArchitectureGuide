import type { ConceptGuide, ConceptLink } from '@archguide/core';

/**
 * What the builder tells a user who picks a concept (Implementation.md §13.11): where it is
 * used in real projects, and the connections people draw most often, with the reason.
 * `guides.test.ts` checks every connection against the relation rules.
 */

const out = (type: string, kind: string, note: string): ConceptLink => ({
  direction: 'out',
  type,
  kind,
  note,
});
const from = (kind: string, type: string, note: string): ConceptLink => ({
  direction: 'in',
  type,
  kind,
  note,
});

const REACT: Record<string, ConceptGuide> = {
  'react.app': {
    examples: [
      'An online shop front end: product pages, a cart and a checkout, built with Vite.',
      'An internal admin dashboard where support staff look up orders and refund them.',
    ],
    connections: [
      from('gen.actor', 'calls', 'People use the app in their browser.'),
      out('calls', 'node.service', 'The app sends HTTP requests to its API.'),
      out('calls', 'node.bff', 'With a Backend-for-Frontend, the app talks only to its BFF.'),
      out('authenticates-with', 'gen.auth-provider', 'Users sign in through the auth provider.'),
      from('node.service', 'serves', 'A Node service can serve the built files.'),
      from('gen.cdn', 'serves', 'More often, a CDN serves the built files.'),
    ],
  },
  'react.route': {
    examples: [
      '`/products/:id` shows one product; `/checkout` shows the checkout form.',
      'An `/admin` route that only signed-in staff may open (`authRequired`).',
    ],
    connections: [
      out('renders', 'react.component', 'A page is built from shared components.'),
      out('navigates', 'react.route', 'Links and redirects take the user to another page.'),
      out('uses-state', 'react.server-state', 'The page shows data cached from the API.'),
      out('uses-state', 'react.client-store', 'The page reads shared state, such as the cart.'),
      out('dispatches', 'react.action', 'A button on the page starts an action (add to cart).'),
      out(
        'depends-on',
        'react.effect',
        'The page runs an effect, for example to load data on open.',
      ),
    ],
  },
  'react.layout': {
    examples: [
      'A shell with the header, the side menu and the footer around every page.',
      'An account area layout with tabs for profile, orders and settings.',
    ],
    connections: [
      out('renders', 'react.component', 'The layout renders the header, menu and footer.'),
      out('navigates', 'react.route', 'The menu links to the pages inside the layout.'),
      out(
        'uses-state',
        'react.client-store',
        'The header shows the signed-in user or the cart count.',
      ),
    ],
  },
  'react.feature': {
    examples: [
      '`src/features/cart`: the cart components, hooks, actions and state in one folder.',
      '`src/features/auth`: the sign-in form, the session hook and the current-user state.',
    ],
    connections: [
      out('renders', 'react.component', 'The feature uses shared components.'),
      out('uses-state', 'react.client-store', 'The feature reads and changes its own state.'),
      out('fetches-via', 'react.api-client', 'The feature loads its data through the API client.'),
      out('dispatches', 'react.action', 'The feature starts actions that change its state.'),
      out('depends-on', 'react.design-system', 'The feature builds its UI from the UI kit.'),
    ],
  },
  'react.component': {
    examples: [
      'A `ProductCard` used on the home page, the search page and in recommendations.',
      'An `AddToCartButton` that any page can show next to a product.',
    ],
    connections: [
      out('renders', 'react.component', 'Components are composed of smaller components.'),
      out('uses-state', 'react.client-store', 'The component reads shared state with a selector.'),
      out('dispatches', 'react.action', 'A click starts an action (`dispatch(addToCart(item))`).'),
      out('depends-on', 'react.hook', 'The component calls a custom hook for its logic.'),
      from('react.route', 'renders', 'Pages render the component.'),
    ],
  },
  'react.design-system': {
    examples: [
      'A `@shop/ui` package with buttons, inputs and dialogs, built on shadcn/ui.',
      'A company component library shared by the customer app and the admin app.',
    ],
    connections: [
      from('react.feature', 'depends-on', 'Features build their screens from the kit.'),
      out('renders', 'react.component', 'Kit components can compose each other.'),
    ],
  },
  'react.hook': {
    examples: [
      '`useCart()` returns the cart and functions to add or remove items.',
      '`useDebouncedSearch(query)` waits until the user stops typing, then searches.',
    ],
    connections: [
      out('uses-state', 'react.client-store', 'The hook reads the store and hides how.'),
      out(
        'uses-state',
        'react.server-state',
        'The hook wraps a query (`useOrders()` around `useQuery`).',
      ),
      out('dispatches', 'react.action', 'The hook offers functions that dispatch actions.'),
      out('fetches-via', 'react.api-client', 'The hook loads data through the API client.'),
      from('react.component', 'depends-on', 'Components call the hook.'),
    ],
  },
  'react.server-state': {
    examples: [
      'TanStack Query caches `GET /products` for five minutes, so going back is instant.',
      'After "Place order", the cache invalidates the orders list and loads it again.',
    ],
    connections: [
      out('fetches-via', 'react.api-client', 'The cache loads data through the API client.'),
      from('react.route', 'uses-state', 'Pages read cached data (`useQuery`).'),
      from('react.hook', 'uses-state', 'Custom hooks wrap queries for one resource.'),
      from('react.action', 'updates', 'An action can update or invalidate cached data.'),
    ],
  },
  'react.client-store': {
    examples: [
      'A Redux store holds the cart, so the header badge and the checkout page show the same items.',
      'A Zustand store keeps the filters of a product list while the user moves between pages.',
      'A Context holds the theme and the language for the whole app.',
    ],
    connections: [
      from(
        'react.action',
        'updates',
        'Actions are the only way the state changes (reducers, `set()`).',
      ),
      from(
        'react.component',
        'uses-state',
        'Components read the state with selectors and re-render when it changes.',
      ),
      from('react.route', 'uses-state', 'Pages read the state they show.'),
      from(
        'react.hook',
        'uses-state',
        'A custom hook hides the store behind a small API (`useCart()`).',
      ),
      from(
        'react.effect',
        'uses-state',
        'An effect can react to a state change, for example save the cart.',
      ),
    ],
  },
  'react.action': {
    examples: [
      '`addToCart(item)`: a Redux action whose reducer case adds the item to the cart state.',
      '`fetchOrders()`: a thunk (`createAsyncThunk`) that calls `GET /orders` and stores the result.',
      '`setFilter("shoes")`: a Zustand action that changes one field of the store.',
    ],
    connections: [
      out('updates', 'react.client-store', 'The action changes the state in the store.'),
      out(
        'fetches-via',
        'react.api-client',
        'A thunk calls the API first, then updates the store with the answer.',
      ),
      from('react.component', 'dispatches', 'A click or a form submit dispatches the action.'),
      from(
        'react.effect',
        'dispatches',
        'An effect dispatches it, for example to load data when a page opens.',
      ),
      from('react.route', 'dispatches', 'A page dispatches it when it needs to change state.'),
      out(
        'updates',
        'react.server-state',
        'An action can also update or invalidate cached server data.',
      ),
    ],
  },
  'react.effect': {
    examples: [
      'When the order page opens, `useEffect(() => dispatch(fetchOrder(id)), [id])` loads the order.',
      'An effect opens a WebSocket for live prices and closes it when the page closes (cleanup).',
      'An effect saves the cart to localStorage each time the cart changes.',
    ],
    connections: [
      out(
        'dispatches',
        'react.action',
        'The effect triggers an action, for example a thunk that loads data.',
      ),
      out(
        'fetches-via',
        'react.api-client',
        'The effect calls the API directly (prefer a server-state cache for this).',
      ),
      out('uses-state', 'react.client-store', 'The effect reads the state it reacts to.'),
      from(
        'react.route',
        'depends-on',
        'A page runs the effect when it opens or when its inputs change.',
      ),
      from('react.component', 'depends-on', 'A component runs the effect.'),
    ],
  },
  'react.api-client': {
    examples: [
      'A `fetch` wrapper that adds the base URL, the auth header and error handling.',
      'A client generated from the OpenAPI spec, so request and response types match the server.',
    ],
    connections: [
      out('calls', 'node.service', 'Every request goes to the API.'),
      out('calls', 'node.bff', 'Or to the Backend-for-Frontend.'),
      out('depends-on', 'node.dto', 'Requests and responses use the shared data shapes.'),
      from('react.server-state', 'fetches-via', 'The query cache loads data through the client.'),
      from('react.action', 'fetches-via', 'Thunks call the API through the client.'),
    ],
  },
};

const NODE: Record<string, ConceptGuide> = {
  'node.service': {
    examples: [
      'An Express API that serves `/api/products` and `/api/orders` to the React app.',
      'A NestJS "orders" service in a system with a separate "payments" service.',
    ],
    connections: [
      from('react.app', 'calls', 'The React app (or its API client) calls the service.'),
      out('reads', 'pg.schema', 'The service reads its own schema.'),
      out('writes', 'pg.schema', 'The service writes its own schema.'),
      out('migrates', 'pg.schema', 'One service owns the migrations of a schema.'),
      out('enqueues', 'pg.job-queue', 'Slow work (emails, reports) goes to a job queue.'),
      out('calls', 'gen.external', 'The service calls Stripe, SendGrid or a partner API.'),
      out(
        'authenticates-with',
        'gen.auth-provider',
        'The service checks tokens with the auth provider.',
      ),
    ],
  },
  'node.bff': {
    examples: [
      'A BFF for the mobile app returns one compact "home screen" response from three services.',
      'A BFF that keeps OAuth tokens on the server and gives the browser a session cookie.',
    ],
    connections: [
      from('react.app', 'calls', 'One frontend calls its own BFF.'),
      out('calls', 'node.service', 'The BFF calls the backend services and combines the answers.'),
      out(
        'authenticates-with',
        'gen.auth-provider',
        'The BFF runs the sign-in flow and keeps the tokens.',
      ),
      out('serves', 'react.app', 'The BFF can also serve the app build.'),
    ],
  },
  'node.worker': {
    examples: [
      'A pg-boss worker sends the order confirmation email after the order is saved.',
      'A worker resizes uploaded product images in the background.',
    ],
    connections: [
      out('processes', 'pg.job-queue', 'The worker takes jobs from the queue and runs them.'),
      out('writes', 'pg.schema', 'The worker saves the result of a job.'),
      out('calls', 'gen.external', 'The worker calls the email or payment provider.'),
      out('migrates', 'pg.schema', 'A worker that owns its schema runs its migrations.'),
    ],
  },
  'node.scheduler': {
    examples: [
      'Every night at 02:00, delete carts older than 30 days.',
      'Every 5 minutes, check payments that are still pending with the provider.',
    ],
    connections: [
      out('enqueues', 'pg.job-queue', 'The schedule adds a job; a worker runs it.'),
      out('writes', 'pg.schema', 'Small clean-up tasks write directly.'),
      out('calls', 'gen.external', 'The task polls an external system.'),
    ],
  },
  'node.ws-gateway': {
    examples: [
      'A Socket.IO server that pushes "order shipped" to the customer’s open browser tab.',
      'Live stock levels on product pages, pushed when stock changes.',
    ],
    connections: [
      from('react.app', 'calls', 'The browser opens a WebSocket to the gateway.'),
      out('listens', 'pg.channel', 'The gateway listens for database notifications to push.'),
      out('calls', 'node.service', 'The gateway asks the service for the data to push.'),
    ],
  },
  'node.module': {
    examples: [
      'An `orders` module in a modular monolith, with its own tables and a public API.',
      'A NestJS `PaymentsModule` that groups the payment controller, service and repository.',
    ],
    connections: [
      out('calls', 'node.module', 'Modules call each other only through their public API.'),
      out('writes', 'pg.schema', 'A module owns its own schema.'),
      out('emits', 'node.event', 'A module tells others what happened with an event.'),
      out('handles', 'node.event', 'A module reacts to events from other modules.'),
    ],
  },
  'node.route-handler': {
    examples: [
      'An Express router for `/orders`: it validates the body with zod and calls `PlaceOrder`.',
      'A NestJS `ProductsController` with `GET /products` and `GET /products/:id`.',
    ],
    connections: [
      out('calls', 'node.use-case', 'The handler turns HTTP into a call to a use case.'),
      out('depends-on', 'node.dto', 'The handler validates the request against a data shape.'),
      out(
        'depends-on',
        'node.middleware',
        'Auth and validation middleware run before the handler.',
      ),
      out('calls', 'node.repository', 'In a small app, the handler reads data directly.'),
    ],
  },
  'node.middleware': {
    examples: [
      'An auth middleware that checks the session cookie and rejects requests without one.',
      'A rate limiter that allows 100 requests per minute per IP address.',
    ],
    connections: [
      out(
        'authenticates-with',
        'gen.auth-provider',
        'Auth middleware verifies tokens with the provider.',
      ),
      from('node.route-handler', 'depends-on', 'Handlers run behind the middleware.'),
    ],
  },
  'node.use-case': {
    examples: [
      '`PlaceOrder`: check stock, reserve it, save the order and enqueue the email, in one transaction.',
      '`RefundOrder`: check the order state, call the payment provider and record the refund.',
    ],
    connections: [
      from('node.route-handler', 'calls', 'HTTP handlers, jobs and scripts all call the use case.'),
      out('depends-on', 'node.domain', 'The use case asks the domain model to apply the rules.'),
      out(
        'uses-port',
        'node.port',
        'The use case saves and loads through a port, not a database library.',
      ),
      out('calls', 'node.repository', 'In a layered design, the use case calls the repository.'),
      out('enqueues', 'pg.job-queue', 'Follow-up work goes to a job queue.'),
    ],
  },
  'node.domain': {
    examples: [
      'An `Order` aggregate that refuses to ship an order that is not paid.',
      'A `Money` value object that does not let you add euros to dollars.',
    ],
    connections: [
      from('node.use-case', 'depends-on', 'Use cases load the aggregate and call its methods.'),
      out('emits', 'node.event', 'The aggregate records what happened (`OrderPlaced`).'),
      out('uses-port', 'node.port', 'Rarely, the domain needs a port (a clock, a price list).'),
    ],
  },
  'node.port': {
    examples: [
      '`OrderRepository` with `findById` and `save`; Prisma code implements it.',
      '`PaymentGateway` with `charge` and `refund`; a Stripe adapter implements it.',
    ],
    connections: [
      from('node.repository', 'implements', 'An adapter implements the port.'),
      from('node.use-case', 'uses-port', 'The use case depends on the port only.'),
    ],
  },
  'node.repository': {
    examples: [
      '`PrismaOrderRepository` loads and saves orders with Prisma.',
      'A Kysely repository with the SQL for the product search.',
    ],
    connections: [
      out('reads', 'pg.schema', 'The repository runs the queries.'),
      out('writes', 'pg.schema', 'The repository saves the data.'),
      out('implements', 'node.port', 'In a hexagonal design, it implements a port.'),
      out('invokes', 'pg.function', 'The repository calls a database function.'),
    ],
  },
  'node.event': {
    examples: [
      '`OrderPlaced`: the warehouse module starts picking, the email module sends a receipt.',
      '`PaymentFailed`: the order module cancels the order after three failures.',
    ],
    connections: [
      from('node.domain', 'emits', 'The domain model or a module raises the event.'),
      from('node.module', 'handles', 'Other modules react to it.'),
      from('node.use-case', 'emits', 'A use case raises it after saving the data.'),
    ],
  },
  'node.contract': {
    examples: [
      'An `openapi.yaml` that both the client generator and the server validation use.',
      'A `@shop/api` package with zod schemas, imported by the React app and the API.',
    ],
    connections: [
      from(
        'react.api-client',
        'depends-on',
        'The client is generated from or typed by the contract.',
      ),
      from('node.route-handler', 'depends-on', 'The server validates requests against it.'),
    ],
  },
  'node.endpoint': {
    examples: [
      '`POST /orders` creates an order; it answers 201, 400 (bad input) or 409 (out of stock).',
      '`GET /products?cursor=…` returns one page of products with cursor pagination.',
    ],
    connections: [
      out('depends-on', 'node.dto', 'The endpoint has a request and a response data shape.'),
      out('calls', 'node.use-case', 'The endpoint runs one use case.'),
      from('react.api-client', 'calls', 'The client calls the endpoint.'),
    ],
  },
  'node.dto': {
    examples: [
      '`CreateOrderRequest { items: { productId, quantity }[] }`: what the browser sends.',
      '`OrderSummary { id, total, status }`: what a list page gets, without internal fields.',
    ],
    connections: [
      from('node.endpoint', 'depends-on', 'Endpoints use it as their request or response.'),
      from('react.api-client', 'depends-on', 'The client sends and receives it.'),
      out('depends-on', 'node.dto', 'A data shape can contain other data shapes.'),
    ],
  },
  'node.shared-lib': {
    examples: [
      'A `@shop/config` package that reads and validates environment variables.',
      'A `@shop/logger` package used by the API and the worker.',
    ],
    connections: [
      from('node.module', 'depends-on', 'Several apps and modules import it.'),
      from('node.service', 'depends-on', 'Services import it.'),
    ],
  },
};

const POSTGRES: Record<string, ConceptGuide> = {
  'pg.cluster': {
    examples: [
      'One managed Postgres server (AWS RDS, Neon) that holds the shop database.',
      'A self-hosted server with a primary and a read replica.',
    ],
    connections: [],
  },
  'pg.database': {
    examples: [
      'A `shop` database with the schemas `orders`, `catalog` and `jobs`.',
      'One database per service when teams deploy separately.',
    ],
    connections: [
      from('node.service', 'reads', 'Services read it (better: point at the schema they own).'),
      out('replicates-to', 'pg.replica', 'A replica copies it for reports or read scaling.'),
      from('pg.pooler', 'connects-via', 'A pooler shares connections to it.'),
    ],
  },
  'pg.schema': {
    examples: [
      'An `orders` schema owned by the orders service; nobody else changes its tables.',
      'The default `public` schema in a small app.',
    ],
    connections: [
      from('node.service', 'migrates', 'One service owns its migrations.'),
      from('node.service', 'writes', 'The owner writes it.'),
      from('node.repository', 'reads', 'Repositories run the queries.'),
    ],
  },
  'pg.table': {
    examples: [
      '`orders (id, customer_id, status, total, created_at)` with an index on `customer_id`.',
      '`order_items` with a foreign key to `orders`.',
    ],
    connections: [
      from('node.repository', 'writes', 'Code writes rows through a repository.'),
      from('pg.trigger', 'fires-on', 'A trigger runs when rows change.'),
    ],
  },
  'pg.function': {
    examples: [
      '`reserve_stock(product_id, qty)` checks and updates stock in one statement, without race conditions.',
      'A function that computes a report next to the data, so only the result leaves the database.',
    ],
    connections: [
      from('node.repository', 'invokes', 'Code runs it with `SELECT reserve_stock(...)`.'),
      from('pg.trigger', 'invokes', 'A trigger runs it when rows change.'),
      out('writes', 'pg.table', 'The function changes rows.'),
    ],
  },
  'pg.trigger': {
    examples: [
      'Set `updated_at = now()` on every update of `orders`.',
      'Write a row to `audit_log` each time a price changes.',
    ],
    connections: [
      out('fires-on', 'pg.table', 'The trigger watches a table.'),
      out('invokes', 'pg.function', 'The trigger runs a function.'),
    ],
  },
  'pg.view': {
    examples: [
      'A `daily_sales` materialized view, refreshed every hour, for the admin dashboard.',
      'A `public_products` view that hides the purchase price column.',
    ],
    connections: [
      from('node.repository', 'reads', 'Code reads the view like a table.'),
      from('pg.trigger', 'fires-on', 'An INSTEAD OF trigger makes a view writable.'),
    ],
  },
  'pg.replica': {
    examples: [
      'Reports and exports run on a replica, so they do not slow down checkouts.',
      'A standby that takes over when the primary fails.',
    ],
    connections: [
      from('pg.database', 'replicates-to', 'The primary sends its changes to the replica.'),
      from('node.service', 'reads', 'Read-only queries go to the replica.'),
    ],
  },
  'pg.pooler': {
    examples: [
      'PgBouncer in transaction mode lets 20 API instances share 50 database connections.',
      'RDS Proxy in front of a database used by serverless functions.',
    ],
    connections: [
      from(
        'node.service',
        'connects-via',
        'App instances connect to the pooler, not the database.',
      ),
      out('connects-via', 'pg.database', 'The pooler holds the real connections.'),
    ],
  },
  'pg.job-queue': {
    examples: [
      'pg-boss queues `send-email` jobs in the same transaction as the order, so no email is lost.',
      'graphile-worker runs a `generate-invoice` job with retries and backoff.',
    ],
    connections: [
      from('node.use-case', 'enqueues', 'Code adds jobs.'),
      from('node.worker', 'processes', 'A worker runs them.'),
    ],
  },
  'pg.channel': {
    examples: [
      '`NOTIFY stock_changed` tells the realtime gateway to push new stock levels.',
      'Cache invalidation between API instances.',
    ],
    connections: [
      from('node.service', 'notifies', 'Code (or a trigger function) sends the notification.'),
      from(
        'node.ws-gateway',
        'listens',
        'Listeners receive it if they are connected at that moment.',
      ),
    ],
  },
};

const GENERIC: Record<string, ConceptGuide> = {
  'gen.actor': {
    examples: ['A customer who buys products.', 'A support agent who refunds orders.'],
    connections: [
      out('calls', 'react.app', 'People use the system through an app.'),
      out('calls', 'gen.external', 'Some people use external tools, for example a payment page.'),
    ],
  },
  'gen.external': {
    examples: ['Stripe for payments.', 'SendGrid for email.', 'A carrier API for shipping labels.'],
    connections: [
      from('node.service', 'calls', 'Your services call it.'),
      from('node.worker', 'calls', 'Slow or unreliable calls are better made from a worker.'),
    ],
  },
  'gen.auth-provider': {
    examples: [
      'Auth0 or Clerk for customer sign-in with Google and passkeys.',
      'Keycloak for single sign-on for staff.',
    ],
    connections: [
      from('react.app', 'authenticates-with', 'Users sign in through it.'),
      from('node.middleware', 'authenticates-with', 'The API checks tokens with it.'),
    ],
  },
  'gen.gateway': {
    examples: [
      'nginx sends `/api/*` to the Node service and everything else to the static files.',
      'A cloud API gateway that checks API keys and rate limits.',
    ],
    connections: [
      from('gen.actor', 'calls', 'Requests from outside arrive here first.'),
      out('calls', 'node.service', 'The gateway forwards requests to services.'),
    ],
  },
  'gen.cdn': {
    examples: [
      'CloudFront serves the React build from locations near the users.',
      'Netlify hosts the static app.',
    ],
    connections: [
      out('serves', 'react.app', 'The CDN delivers the built app.'),
      from('gen.actor', 'calls', 'Browsers download the app files from the CDN.'),
    ],
  },
  'gen.other-store': {
    examples: ['Redis for sessions and caching.', 'S3 for uploaded images.'],
    connections: [
      from('node.service', 'reads', 'Services read it.'),
      from('node.service', 'writes', 'Services write it.'),
    ],
  },
  'gen.other-broker': {
    examples: ['Kafka between teams.', 'RabbitMQ or SQS for work queues.'],
    connections: [
      from('node.service', 'publishes', 'Producers publish messages.'),
      from('node.worker', 'consumes', 'Consumers receive them.'),
    ],
  },
  'gen.cross-cutting': {
    examples: [
      'Structured logging and tracing with OpenTelemetry.',
      'Feature flags that turn a new checkout on for 10% of users.',
    ],
    connections: [],
  },
  'group.layer': {
    examples: ['Presentation, application, domain and infrastructure layers in a layered API.'],
    connections: [],
  },
  'group.context': {
    examples: [
      '"Ordering" and "Shipping" are separate contexts: an "order" means something different in each.',
    ],
    connections: [],
  },
  'group.zone': {
    examples: [
      'A public zone with the gateway, and a private network with the services and the database.',
    ],
    connections: [],
  },
  'group.team': {
    examples: ['The checkout team owns the cart, the orders service and their schema.'],
    connections: [],
  },
};

export const GUIDES: Record<string, ConceptGuide> = {
  ...REACT,
  ...NODE,
  ...POSTGRES,
  ...GENERIC,
};
