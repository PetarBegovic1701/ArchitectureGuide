import { describe, expect, it } from 'vitest';
import {
  applyChangeSetOps,
  applyOps,
  changeSetDiff,
  changeSetFindings,
  createCatalog,
  createChangeSet,
  createProject,
  describeOp,
  drillDown,
  generateViewOps,
  viewBreadcrumbs,
  viewElementIds,
  effectiveProject,
  exportProject,
  generateTasks,
  rebaseChangeSet,
  recordOps,
} from '@archguide/core';
import type { ChangeSet, Element, ModelOp, Project, Relation } from '@archguide/core';
import { PROFILE_ID, profile } from '.';

const catalog = createCatalog([profile]);
const NOW = '2026-10-28T00:00:00.000Z';

const el = (id: string, kind: string, name: string, extra: Partial<Element> = {}): ModelOp => ({
  op: 'addElement',
  element: { id, kind, name, status: 'existing', ...extra } as Element,
});
const rel = (
  sourceId: string,
  type: string,
  targetId: string,
  extra: Partial<Relation> = {},
): ModelOp => ({
  op: 'addRelation',
  relation: {
    id: `rel.${sourceId.replace(/\./g, '-')}-${type}-${targetId.replace(/\./g, '-')}`,
    sourceId,
    targetId,
    type,
    status: 'existing',
    ...extra,
  } as Relation,
});

function apply(p: Project, ops: readonly unknown[]): Project {
  const r = applyOps(p, ops, catalog);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.project;
}

/** The shop of §18.4 before the change: web app → BFF → orders service → Postgres. */
function shop(): Project {
  const base = createProject({ id: 'shop', name: 'Shop', profile: PROFILE_ID, now: NOW });
  return apply(base, [
    el('app.web', 'react.app', 'Web'),
    el('bff.web', 'node.bff', 'Web BFF', { codePaths: ['services/bff'] }),
    el('svc.orders', 'node.service', 'Orders', { codePaths: ['services/orders'] }),
    el('db.shop', 'pg.database', 'Shop DB'),
    el('schema.orders', 'pg.schema', 'orders', { parentId: 'db.shop' }),
    rel('app.web', 'calls', 'bff.web', { protocol: 'https' }),
    rel('bff.web', 'calls', 'svc.orders', { protocol: 'https' }),
    rel('svc.orders', 'migrates', 'schema.orders'),
    rel('svc.orders', 'writes', 'schema.orders'),
  ]);
}

const PAYMENT_OPS: ModelOp[] = [
  el('svc.payments', 'node.service', 'Payments', {
    status: 'planned',
    tech: 'NestJS',
    responsibilities: ['Create payment intents, handle Stripe webhooks'],
    codePaths: ['services/payments'],
  }),
  el('port.payment-gateway', 'node.port', 'PaymentGateway', {
    status: 'planned',
    parentId: 'svc.payments',
  }),
  el('rh.webhooks', 'node.route-handler', 'Stripe webhooks', {
    status: 'planned',
    parentId: 'svc.payments',
  }),
  el('ep.stripe-webhook', 'node.endpoint', 'Stripe webhook', {
    status: 'planned',
    parentId: 'rh.webhooks',
    properties: { method: 'POST', path: '/webhooks/stripe', statusCodes: [200, 400] },
  }),
  el('schema.payments', 'pg.schema', 'payments', { status: 'planned', parentId: 'db.shop' }),
  el('ext.stripe', 'gen.external', 'Stripe API', { status: 'planned' }),
  el('jobs.payments', 'pg.job-queue', 'payments', {
    status: 'planned',
    parentId: 'db.shop',
    tech: 'pg-boss',
  }),
  rel('svc.payments', 'calls', 'ext.stripe', { protocol: 'https' }),
  rel('svc.payments', 'migrates', 'schema.payments'),
  rel('svc.payments', 'writes', 'schema.payments'),
  rel('svc.payments', 'enqueues', 'jobs.payments', {
    label: 'payment.succeeded',
    inTransaction: true,
  }),
  rel('svc.orders', 'processes', 'jobs.payments', { label: 'payment.succeeded' }),
  rel('bff.web', 'calls', 'svc.payments', { protocol: 'https' }),
];

function withChangeSet(): { project: Project; cs: ChangeSet } {
  let project = shop();
  const empty = createChangeSet(project, {
    name: 'Add Stripe payments',
    description:
      'Users pay for an order with a card. Orders become "paid" after the Stripe webhook.',
    now: NOW,
  });
  const recorded = recordOps(project, empty, PAYMENT_OPS, catalog);
  if (!recorded.ok) throw new Error(recorded.message);
  project = apply(project, [{ op: 'upsertChangeSet', changeSet: recorded.changeSet }]);
  return { project, cs: recorded.changeSet };
}

describe('change sets', () => {
  it('records ops on top of the baseline and shows the overlay', () => {
    const { project, cs } = withChangeSet();
    expect(cs.id).toBe('cs.add-stripe-payments');
    expect(cs.baseRevision).toBe(shop().revision);
    // The baseline is untouched.
    expect(project.model.elements.some((e) => e.id === 'svc.payments')).toBe(false);
    const state = effectiveProject(project, cs, catalog);
    expect(state.conflicts).toEqual([]);
    const diff = changeSetDiff(state);
    expect(diff.added.elements).toContain('svc.payments');
    expect(diff.added.relations).toHaveLength(6);
    expect(describeOp(cs.ops[0]!)).toBe('Add svc.payments (node.service)');
    expect(describeOp(cs.ops.at(-1)!)).toBe('Add bff.web calls svc.payments');
  });

  it('refuses ops that do not apply on top of the change', () => {
    const { project, cs } = withChangeSet();
    const r = recordOps(project, cs, [rel('svc.payments', 'calls', 'svc.nope')], catalog);
    expect(r.ok).toBe(false);
  });

  it('shows only the findings the change introduces', () => {
    const { project, cs } = withChangeSet();
    const state = effectiveProject(project, cs, catalog);
    const { all, introduced } = changeSetFindings(state, catalog);
    expect(introduced.length).toBeLessThanOrEqual(all.length);
    const unsafe = recordOps(
      project,
      cs,
      [rel('svc.payments', 'writes', 'schema.orders')],
      catalog,
    );
    if (!unsafe.ok) throw new Error(unsafe.message);
    const after = changeSetFindings(effectiveProject(project, unsafe.changeSet, catalog), catalog);
    expect(after.introduced.length).toBeGreaterThan(introduced.length);
    expect(after.introduced.some((f) => f.targetIds.includes('schema.orders'))).toBe(true);
  });

  it('lists conflicts when the baseline changes under the change set', () => {
    const { project, cs } = withChangeSet();
    const moved = apply(project, [{ op: 'removeElement', id: 'svc.orders', cascade: true }]);
    const { changeSet, conflicts } = rebaseChangeSet(moved, cs, catalog);
    expect(changeSet.baseRevision).toBe(moved.revision + 1);
    expect(conflicts.map((c) => c.op.op)).toEqual(['addRelation']);
    expect(conflicts[0]!.message).toMatch(/svc\.orders/);
    expect(applyChangeSetOps(moved, cs, catalog).ok).toBe(false);
  });

  it('applies to the baseline and marks the change set implemented', () => {
    const { project, cs } = withChangeSet();
    const r = applyChangeSetOps(project, cs, catalog);
    if (!r.ok) throw new Error('conflicts');
    const merged = apply(project, r.ops);
    expect(merged.model.elements.some((e) => e.id === 'svc.payments')).toBe(true);
    expect(merged.changeSets[0]!.status).toBe('implemented');
  });
});

describe('task generation (§16.4)', () => {
  it('orders the work: data first, then the service, the consumers and the BFF', () => {
    const { project, cs } = withChangeSet();
    const tasks = generateTasks(project, cs, catalog);
    const titles = tasks.map((t) => t.title);
    const at = (t: string) => titles.indexOf(t);
    expect(at('Create schema.payments')).toBeGreaterThanOrEqual(0);
    expect(at('Create schema.payments')).toBeLessThan(at('Create svc.payments'));
    expect(at('Create jobs.payments')).toBeLessThan(at('Create svc.payments'));
    expect(at('Create ext.stripe')).toBeLessThan(at('Create svc.payments'));
    expect(at('Create svc.payments')).toBeLessThan(at('Create rh.webhooks'));
    expect(at('Change svc.orders')).toBeGreaterThan(at('Create jobs.payments'));
    expect(at('Change bff.web')).toBeGreaterThan(at('Create svc.payments'));
    // Leaves become steps of their parent's task.
    expect(titles).not.toContain('Create port.payment-gateway');
    expect(titles).not.toContain('Create ep.stripe-webhook');
    const svc = tasks.find((t) => t.title === 'Create svc.payments')!;
    expect(svc.detail).toContain('Add port (interface) `PaymentGateway`');
    expect(svc.detail).toContain(
      'Enqueue to `jobs.payments` (payment.succeeded) in the same transaction',
    );
    expect(svc.detail).toContain('Code: `services/payments`');
    expect(svc.dependsOn).toEqual(
      expect.arrayContaining(
        ['Create schema.payments', 'Create jobs.payments', 'Create ext.stripe'].map(
          (t) => tasks.find((x) => x.title === t)!.id,
        ),
      ),
    );
    expect(tasks.find((t) => t.title === 'Create rh.webhooks')!.detail).toContain(
      'Expose `POST /webhooks/stripe`',
    );
    const orders = tasks.find((t) => t.title === 'Change svc.orders')!;
    expect(orders.detail).toContain('Process jobs from `jobs.payments` (payment.succeeded)');
  });

  it('puts removals last and keeps ticked tasks ticked', () => {
    const { project, cs } = withChangeSet();
    const more: ChangeSet = {
      ...cs,
      ops: [...cs.ops, { op: 'removeElement', id: 'app.web', cascade: true }],
    };
    const tasks = generateTasks(project, more, catalog);
    expect(tasks.at(-1)!.title).toBe('Remove app.web');
    const ticked = tasks.map((t) =>
      t.title === 'Create schema.payments' ? { ...t, done: true } : t,
    );
    const again = generateTasks(project, { ...more, tasks: ticked }, catalog);
    expect(again.find((t) => t.title === 'Create schema.payments')!.done).toBe(true);
  });

  it('puts elements that need each other into one task', () => {
    const { project, cs } = withChangeSet();
    const cyclic = recordOps(
      project,
      cs,
      [
        el('svc.a', 'node.service', 'A', { status: 'planned' }),
        el('svc.b', 'node.service', 'B', { status: 'planned' }),
        rel('svc.a', 'calls', 'svc.b'),
        rel('svc.b', 'calls', 'svc.a'),
      ],
      catalog,
    );
    if (!cyclic.ok) throw new Error(cyclic.message);
    const task = generateTasks(project, cyclic.changeSet, catalog).find((t) =>
      t.elementIds.includes('svc.a'),
    )!;
    expect(task.elementIds).toEqual(expect.arrayContaining(['svc.a', 'svc.b']));
    expect(task.detail).toMatch(/cycle/);
  });
});

describe('plan exports (§18.4, §18.6)', () => {
  it('plan-md: front matter, changes, invariants, rule check and tasks', () => {
    const { project, cs } = withChangeSet();
    const [file] = exportProject('plan-md', project, catalog, { changeSetId: cs.id }).files;
    expect(file!.path).toBe('plans/cs.add-stripe-payments.md');
    const md = file!.content;
    expect(md).toMatch(
      /^---\narchguide: 1\nproject: shop\nchangeSet: cs.add-stripe-payments\nstatus: draft\nbaseRevision: \d+\n---/,
    );
    expect(md).toContain('# Plan: Add Stripe payments');
    expect(md).toContain('> Users pay for an order with a card.');
    expect(md).toContain(
      '| ADD | svc.payments (node.service) | NestJS; "Create payment intents, handle Stripe webhooks"; code: services/payments |',
    );
    expect(md).toContain(
      '| ADD | svc.payments enqueues jobs.payments | payment.succeeded; inTransaction: true |',
    );
    expect(md).toContain('## Invariants this change must respect');
    expect(md).toContain('## Rule check (baseline + change)');
    expect(md).toMatch(/## Tasks\n\n1\. \*\*Create /);
    expect(md).toMatch(/\d+\. Run `archguide check`\.\n$/);
  });

  it('Spec Kit and Kiro layouts', () => {
    const { project, cs } = withChangeSet();
    const spec = exportProject('speckit', project, catalog, { changeSetId: cs.id }).files;
    expect(spec.map((f) => f.path)).toEqual([
      'specs/001-add-stripe-payments/spec.md',
      'specs/001-add-stripe-payments/plan.md',
      'specs/001-add-stripe-payments/tasks.md',
    ]);
    expect(spec[2]!.content).toMatch(/- \[ \] T001 Create /);
    expect(spec[1]!.content).toContain('```mermaid\nflowchart LR');
    expect(spec[1]!.content).toContain('classDef added');
    const k = exportProject('kiro', project, catalog, { changeSetId: cs.id }).files;
    expect(k.map((f) => f.path)).toEqual([
      '.kiro/specs/add-stripe-payments/requirements.md',
      '.kiro/specs/add-stripe-payments/design.md',
      '.kiro/specs/add-stripe-payments/tasks.md',
    ]);
    const req = k[0]!.content;
    expect(req).toContain(
      'WHEN `svc.payments` completes the action, THE SYSTEM SHALL enqueue `payment.succeeded` on `jobs.payments` in the same transaction as its data change.',
    );
    expect(req).toContain(
      'WHEN a client sends `POST /webhooks/stripe`, THE SYSTEM SHALL handle it in `rh.webhooks`',
    );
    expect(k[2]!.content).toMatch(/_Requirements: \d+_/);
  });

  it('needs a change set, and exports baseline + change for other formats', () => {
    const { project, cs } = withChangeSet();
    expect(() => exportProject('plan-md', project, catalog)).toThrow(/change set/);
    const md = exportProject('agent-md', project, catalog, { changeSetId: cs.id }).files[0]!;
    expect(md.content).toContain('svc.payments');
    expect(exportProject('agent-md', project, catalog).files[0]!.content).not.toContain(
      'svc.payments',
    );
  });
});

describe('interop and API exports', () => {
  const merged = () => {
    const { project, cs } = withChangeSet();
    const r = applyChangeSetOps(project, cs, catalog);
    if (!r.ok) throw new Error('conflicts');
    return apply(project, r.ops);
  };

  it('LikeC4, Structurizr and C4-PlantUML', () => {
    const p = merged();
    const c4 = exportProject('likec4', p, catalog).files[0]!.content;
    expect(c4).toMatch(/^specification \{\n {2}element gen_external \{/);
    expect(c4).toContain("  svc_payments = node_service 'Payments' {");
    expect(c4).toContain("    technology 'NestJS'");
    expect(c4).toContain("  svc_payments -[enqueues]-> db_shop.jobs_payments 'payment.succeeded'");
    expect(c4).toContain('  relationship enqueues {\n    line dashed\n  }');
    const dsl = exportProject('structurizr', p, catalog).files[0]!.content;
    expect(dsl).toContain('ext_stripe = softwareSystem "Stripe API" "" "External"');
    expect(dsl).toContain('db_shop = container "Shop DB" "" "" "Database" {');
    expect(dsl).toContain('shop.svc_payments -> ext_stripe "calls" "https"');
    expect(dsl).not.toMatch(/shop\.svc_payments -> shop\.svc_payments\./);
    const puml = exportProject('plantuml', p, catalog).files[0]!.content;
    expect(puml).toContain('!include <C4/C4_Container>');
    expect(puml).toContain('ContainerDb(db_shop, "Shop DB", "", "")');
    expect(puml).toContain('System_Ext(ext_stripe, "Stripe API", "")');
    expect(puml).toContain('Rel(svc_payments, db_shop, "enqueues: payment.succeeded")');
    const comp = exportProject('plantuml', p, catalog, { focus: 'svc.payments' }).files[0]!.content;
    expect(comp).toContain('!include <C4/C4_Component>');
    expect(comp).toContain('Container_Boundary(svc_payments, "Payments") {');
    expect(comp).toContain('  Component(rh_webhooks, "Stripe webhooks", "", "")');
  });

  it('OpenAPI skeleton of a route handler, and a scenario as a sequence diagram', () => {
    let p = merged();
    p = apply(p, [
      el('dto.webhook-event', 'node.dto', 'Webhook event', {
        parentId: 'svc.payments',
        properties: {
          role: 'request',
          fields: [
            { name: 'id', type: 'string' },
            { name: 'created', type: 'datetime' },
          ],
        },
      }),
      {
        op: 'updateElement',
        id: 'ep.stripe-webhook',
        patch: {
          properties: {
            method: 'POST',
            path: '/webhooks/stripe/:account',
            statusCodes: [200, 400],
            request: 'dto.webhook-event',
            auth: 'required',
            idempotent: true,
          },
        },
      },
    ]);
    const yaml = exportProject('openapi', p, catalog, { focus: 'rh.webhooks' }).files[0]!;
    expect(yaml.path).toBe('rh.webhooks.openapi.yaml');
    expect(yaml.content).toContain('openapi: 3.1.0');
    expect(yaml.content).toContain('  /webhooks/stripe/{account}:\n    post:');
    expect(yaml.content).toContain('$ref: "#/components/schemas/WebhookEvent"');
    expect(yaml.content).toContain('format: date-time');
    expect(yaml.content).toContain('bearerAuth');
    expect(yaml.content).toContain('Idempotency-Key');

    const steps = [
      'rel.app-web-calls-bff-web',
      'rel.bff-web-calls-svc-payments',
      'rel.svc-payments-enqueues-jobs-payments',
    ];
    for (const id of steps) expect(p.model.relations.some((r) => r.id === id)).toBe(true);
    p = apply(p, [
      {
        op: 'addView',
        view: {
          id: 'pay',
          name: 'Pay for an order',
          kind: 'scenario',
          nodes: [],
          edges: [],
          annotations: [],
          scenario: {
            steps: steps.map((relationId, i) => ({
              relationId,
              ...(i === 2 ? { note: 'in the payment transaction' } : {}),
            })),
          },
        },
      },
    ]);
    const seq = exportProject('sequence', p, catalog, { viewId: 'pay' }).files[0]!.content;
    expect(seq).toBe(
      [
        'sequenceDiagram',
        '  title Pay for an order',
        '  autonumber',
        '  participant app__web as Web',
        '  participant bff__web as Web BFF',
        '  participant svc__payments as Payments',
        '  participant jobs__payments as payments',
        '  app__web->>bff__web: calls',
        '  bff__web->>svc__payments: calls',
        '  svc__payments-)jobs__payments: enqueues: payment.succeeded',
        '  Note over svc__payments,jobs__payments: in the payment transaction',
        '',
      ].join('\n'),
    );
  });
});

describe('generated views (§13.8)', () => {
  const merged = () => {
    const { project, cs } = withChangeSet();
    const r = applyChangeSetOps(project, cs, catalog);
    if (!r.ok) throw new Error('conflicts');
    return apply(project, [
      ...r.ops,
      el('user', 'gen.actor', 'Shopper'),
      rel('user', 'calls', 'app.web'),
    ]);
  };

  it('context, container and component views show the right level', () => {
    const p = merged();
    const ctx = viewElementIds(p, catalog, 'context');
    expect([...ctx].sort()).toEqual(
      ['app.web', 'bff.web', 'ext.stripe', 'svc.orders', 'svc.payments', 'user'].sort(),
    );
    const containers = viewElementIds(p, catalog, 'container');
    expect(containers.has('db.shop')).toBe(true);
    expect(containers.has('schema.orders')).toBe(false);
    const comp = viewElementIds(p, catalog, 'component', 'svc.payments');
    // Inside, plus what it talks to, lifted to the deployable or the database.
    expect([...comp].sort()).toEqual(
      [
        'svc.payments',
        'port.payment-gateway',
        'rh.webhooks',
        'ep.stripe-webhook',
        'ext.stripe',
        'db.shop',
        'bff.web',
      ].sort(),
    );
  });

  it('drills down into a deployable and a database, and shows breadcrumbs', () => {
    let p = merged();
    const target = drillDown(p, catalog, 'svc.payments');
    expect(target).toEqual({ create: { kind: 'component', scopeElementId: 'svc.payments' } });
    const { ops, viewId } = generateViewOps(p, catalog, (target as { create: never }).create);
    p = apply(p, ops);
    const view = p.views.find((v) => v.id === viewId)!;
    expect(view).toMatchObject({
      kind: 'component',
      scopeElementId: 'svc.payments',
      name: 'Components: Payments',
    });
    expect(view.nodes.map((n) => n.elementId)).toContain('rh.webhooks');
    expect(view.edges.length).toBeGreaterThan(0);
    expect(drillDown(p, catalog, 'svc.payments')).toEqual({ viewId });
    expect(viewBreadcrumbs(p, viewId).map((v) => v.id)).toEqual(['main', viewId]);
    expect(drillDown(p, catalog, 'schema.orders')).toBeUndefined();
    const db = drillDown(p, catalog, 'db.shop') as {
      create: { kind: 'database'; scopeElementId: string };
    };
    expect(db.create.kind).toBe('database');
    const dbView = generateViewOps(p, catalog, db.create);
    p = apply(p, dbView.ops);
    expect(p.views.find((v) => v.id === dbView.viewId)).toMatchObject({
      kind: 'database',
      scopeElementId: 'db.shop',
    });
  });

  it('a scenario starts as a copy of a view with no steps', () => {
    let p = merged();
    const { ops, viewId } = generateViewOps(p, catalog, {
      kind: 'scenario',
      name: 'Pay',
      fromViewId: 'main',
    });
    p = apply(p, ops);
    const v = p.views.find((x) => x.id === viewId)!;
    expect(v.scenario).toEqual({ steps: [] });
    expect(v.nodes.length).toBe(p.views[0]!.nodes.length);
  });
});
