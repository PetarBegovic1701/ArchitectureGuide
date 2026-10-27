---
id: pattern.modular-monolith
kind: pattern
title: Modular monolith
summary: One deployable, split into modules with clear owners. Each module owns its tables and offers a public API to the others.
level: intermediate
tracks: [patterns, data-and-models]
tags: [nestjs, modules, boundaries]
related:
  [node.module, node.service, pg.schema, migrates, pattern.database-per-service, pattern.layered]
references:
  - title: Shopify Engineering — Deconstructing the Monolith
    url: https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity
  - title: Martin Fowler — MonolithFirst
    url: https://martinfowler.com/bliki/MonolithFirst.html
  - title: NestJS — Modules
    url: https://docs.nestjs.com/modules
quiz:
  - question: The Billing module needs an order's total. What should it do?
    options:
      - Query the orders table directly
      - Call the OrdersService that the Orders module exports
      - Copy the Orders repository into Billing
      - Add a trigger on the orders table
    answer: 1
    explanation: Only the owning module touches its tables. Others use its public API, so Orders can change its tables without breaking Billing.
---

## Beginner

A **monolith** is one application that you deploy as one unit. A **modular** monolith
is still one application, but its code is split into modules (Orders, Catalog,
Billing) with walls between them:

- Each module has its own folder, its own tables, and an owner.
- A module only uses another module through what it **exports**, such as an
  `OrdersService`.
- Nobody reads another module's tables.

You get one deploy and real database transactions, without the tangle of a
"big ball of mud".

## Intermediate

- Give each module its own PostgreSQL **schema** (`orders`, `billing`). It makes
  ownership visible, and lets you grant privileges per schema later.
- In NestJS, `@Module({ exports: [...] })` defines the public API. Keep repositories
  and entities out of `exports`.
- Enforce the walls in CI: dependency-cruiser or ESLint boundaries rules that forbid
  imports from another module's internals.
- Cross-module workflows: call the other module's service, or emit an in-process event
  that the other module handles.

## Senior

The modular monolith is the cheapest way to find the right boundaries. Extracting a
module into a service later is mostly mechanical if the module already owns its data
and talks through an API: the in-process call becomes HTTP or a queue. The hard part is
transactions that span modules today; list them, because each one becomes a saga or an
outbox when you split. Shared "common" modules tend to grow into a second monolith;
keep them to technical utilities.

## Analogy

An apartment building: one structure and one address, but each flat has its own door
and key. Neighbours knock; they do not walk in.

## Common mistakes

- Importing another module's repository "because it is faster".
- One shared `entities` folder for all modules.
- Foreign keys across module schemas that make every module depend on the others.

## Examples

**A NestJS module with a narrow public API:**

```ts
@Module({
  imports: [PrismaModule],
  providers: [OrdersService, OrdersRepository],
  controllers: [OrdersController],
  exports: [OrdersService], // the repository stays private
})
export class OrdersModule {}

@Module({ imports: [OrdersModule], providers: [BillingService] })
export class BillingModule {}

@Injectable()
export class BillingService {
  constructor(private readonly orders: OrdersService) {}
  async invoiceFor(orderId: string) {
    const total = await this.orders.totalOf(orderId); // through the public API
    return this.createInvoice(orderId, total);
  }
}
```
