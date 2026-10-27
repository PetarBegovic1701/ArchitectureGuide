import { describe, expect, it } from 'vitest';
import {
  RULE_PACKS,
  applyOps,
  createCatalog,
  createProject,
  runRules,
  type Element,
  type Project,
  type Relation,
} from '@archguide/core';
import { PROFILE_ID, RULES, profile } from '.';

const catalog = createCatalog([profile]);
const NOW = '2026-01-01T00:00:00.000Z';

type ElSpec = [id: string, kind: string, extra?: Partial<Element>];
type RelSpec = [source: string, type: string, target: string, extra?: Partial<Relation>];

/** A project of this profile with every rule pack on, built through applyOps. */
function build(elements: ElSpec[], relations: RelSpec[] = []): Project {
  const p = createProject({ id: 'fixture', name: 'Fixture', profile: PROFILE_ID, now: NOW });
  p.settings.rulePacks = RULE_PACKS.map((pack) => pack.id);
  const result = applyOps(
    p,
    [
      ...elements.map(([id, kind, extra]) => ({
        op: 'addElement' as const,
        element: { id, kind, name: id, status: 'existing' as const, ...extra },
      })),
      ...relations.map(([sourceId, type, targetId, extra], i) => ({
        op: 'addRelation' as const,
        relation: {
          id: `rel.r${i}-${type}`,
          type,
          sourceId,
          targetId,
          status: 'existing' as const,
          ...extra,
        },
      })),
    ],
    catalog,
  );
  if (!result.ok) throw new Error(`Invalid fixture: ${JSON.stringify(result.errors[0])}`);
  return result.project;
}

const fire = (p: Project, ruleId: string) => runRules(p, catalog, { only: [ruleId] });
const targets = (p: Project, ruleId: string) => fire(p, ruleId).map((f) => f.targetIds);

/** Applies a finding's first quick fix and returns the fixed project. */
function fix(p: Project, ruleId: string, index = 0): Project {
  const [finding] = fire(p, ruleId);
  const quickFix = finding?.fixes[index];
  if (!quickFix) throw new Error(`${ruleId} has no fix ${index}`);
  const result = applyOps(p, quickFix.ops, catalog);
  if (!result.ok) throw new Error(`Fix failed: ${JSON.stringify(result.errors[0])}`);
  return result.project;
}

const db: ElSpec[] = [
  ['db.main', 'pg.database'],
  ['schema.orders', 'pg.schema', { parentId: 'db.main' }],
  ['schema.billing', 'pg.schema', { parentId: 'db.main' }],
  ['tbl.orders', 'pg.table', { parentId: 'schema.orders' }],
  ['tbl.invoices', 'pg.table', { parentId: 'schema.billing' }],
];

describe('profile rules: metadata', () => {
  it('have unique IDs, known packs, rationales and existing learning texts', () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    const packs = new Set([...RULE_PACKS.map((p) => p.id), PROFILE_ID]);
    const docs = new Set(profile.content!.docs.map((d) => d.id));
    for (const r of RULES) {
      expect(r.id, r.id).toMatch(/^RNP-\d{3}$/);
      expect(
        r.packs.every((p) => packs.has(p)),
        r.id,
      ).toBe(true);
      expect(r.rationale.length, r.id).toBeGreaterThan(80);
      if (r.learnId) expect(docs.has(r.learnId), `${r.id} → ${r.learnId}`).toBe(true);
    }
  });

  it('replace the generic rules they refine', () => {
    const p = build(
      [['svc.a', 'node.service'], ['svc.b', 'node.service'], ...db],
      [
        ['svc.a', 'writes', 'tbl.orders'],
        ['svc.b', 'writes', 'tbl.orders'],
      ],
    );
    const ids = runRules(p, catalog).map((f) => f.ruleId);
    expect(ids).toContain('RNP-001');
    expect(ids).not.toContain('AP-001');
  });
});

describe('profile rules: data ownership', () => {
  it('RNP-001 two services write one schema; separate schemas and workers are fine', () => {
    const shared = build(
      [['svc.a', 'node.service'], ['svc.b', 'node.service'], ...db],
      [
        ['svc.a', 'writes', 'tbl.orders'],
        ['svc.b', 'writes', 'schema.orders'],
      ],
    );
    expect(targets(shared, 'RNP-001')).toEqual([['schema.orders']]);
    const separate = build(
      [['svc.a', 'node.service'], ['svc.b', 'node.service'], ['wrk.a', 'node.worker'], ...db],
      [
        ['svc.a', 'writes', 'tbl.orders'],
        ['wrk.a', 'writes', 'tbl.orders'],
        ['svc.b', 'writes', 'tbl.invoices'],
      ],
    );
    expect(fire(separate, 'RNP-001')).toEqual([]);
  });

  it('RNP-002 two migration owners, also through the database', () => {
    const els: ElSpec[] = [['svc.a', 'node.service'], ['svc.b', 'node.service'], ...db];
    const two = build(els, [
      ['svc.a', 'migrates', 'schema.orders'],
      ['svc.b', 'migrates', 'schema.orders'],
    ]);
    expect(fire(two, 'RNP-002')).toMatchObject([
      { severity: 'error', targetIds: ['schema.orders'] },
    ]);
    const viaDb = build(els, [
      ['svc.a', 'migrates', 'db.main'],
      ['svc.b', 'migrates', 'schema.orders'],
    ]);
    expect(targets(viaDb, 'RNP-002')).toEqual([['schema.orders']]);
    const one = build(els, [
      ['svc.a', 'migrates', 'schema.orders'],
      ['svc.b', 'migrates', 'schema.billing'],
    ]);
    expect(fire(one, 'RNP-002')).toEqual([]);
  });

  it('RNP-027 SQL and Node both write a table, unless a decision covers it', () => {
    const els: ElSpec[] = [
      ['svc.a', 'node.service'],
      ...db,
      ['fn.total', 'pg.function', { parentId: 'schema.orders' }],
    ];
    const rels: RelSpec[] = [
      ['svc.a', 'writes', 'tbl.orders'],
      ['fn.total', 'writes', 'tbl.orders'],
    ];
    const p = build(els, rels);
    expect(targets(p, 'RNP-027')).toEqual([['tbl.orders']]);
    p.decisions.push({
      id: 'adr-001',
      title: 'Totals are computed in SQL',
      status: 'accepted',
      context: '',
      decision: '',
      consequences: '',
      linkedIds: ['fn.total'],
      date: NOW,
    });
    expect(fire(p, 'RNP-027')).toEqual([]);
  });
});

describe('profile rules: layers and the domain', () => {
  const svc: ElSpec[] = [
    ['svc.a', 'node.service'],
    ['ctl.orders', 'node.route-handler', { parentId: 'svc.a' }],
    ['uc.place', 'node.use-case', { parentId: 'svc.a' }],
    ['repo.orders', 'node.repository', { parentId: 'svc.a' }],
    ['dom.order', 'node.domain', { parentId: 'svc.a' }],
    ['port.orders', 'node.port', { parentId: 'svc.a' }],
    ...db,
  ];

  it('RNP-005 a route handler queries Postgres directly', () => {
    expect(fire(build(svc, [['ctl.orders', 'reads', 'tbl.orders']]), 'RNP-005')).toHaveLength(1);
    const layered = build(svc, [
      ['ctl.orders', 'depends-on', 'uc.place'],
      ['uc.place', 'depends-on', 'repo.orders'],
      ['repo.orders', 'reads', 'tbl.orders'],
    ]);
    expect(fire(layered, 'RNP-005')).toEqual([]);
  });

  it('RNP-006 the domain depends on a repository; a port is fine', () => {
    expect(fire(build(svc, [['dom.order', 'depends-on', 'repo.orders']]), 'RNP-006')).toHaveLength(
      1,
    );
    const ported = build(svc, [
      ['dom.order', 'uses-port', 'port.orders'],
      ['repo.orders', 'implements', 'port.orders'],
    ]);
    expect(fire(ported, 'RNP-006')).toEqual([]);
  });
});

describe('profile rules: events and jobs', () => {
  const els: ElSpec[] = [
    ['svc.a', 'node.service'],
    ...db,
    ['jobs.main', 'pg.job-queue', { parentId: 'db.main' }],
    ['broker.kafka', 'gen.other-broker'],
    ['tbl.outbox', 'pg.table', { parentId: 'schema.orders', name: 'Outbox' }],
    ['wrk.a', 'node.worker'],
    ['ch.orders', 'pg.channel', { parentId: 'db.main' }],
  ];

  it('RNP-007 enqueue outside the transaction, with a fix that resolves it', () => {
    const p = build(els, [
      ['svc.a', 'writes', 'tbl.orders'],
      ['svc.a', 'enqueues', 'jobs.main'],
    ]);
    expect(targets(p, 'RNP-007')).toEqual([['svc.a']]);
    expect(fire(fix(p, 'RNP-007'), 'RNP-007')).toEqual([]);
    expect(runRules(p, catalog).map((f) => f.ruleId)).not.toContain('AP-013');
  });

  it('RNP-007 publishing to a broker needs an outbox', () => {
    const direct = build(els, [
      ['svc.a', 'writes', 'tbl.orders'],
      ['svc.a', 'publishes', 'broker.kafka'],
    ]);
    expect(fire(direct, 'RNP-007')[0]?.fixes).toEqual([]);
    const outbox = build(els, [
      ['svc.a', 'writes', 'tbl.orders'],
      ['svc.a', 'writes', 'tbl.outbox'],
      ['svc.a', 'publishes', 'broker.kafka'],
    ]);
    expect(fire(outbox, 'RNP-007')).toEqual([]);
    const notify = build(els, [
      ['svc.a', 'writes', 'tbl.orders'],
      ['svc.a', 'notifies', 'ch.orders'],
    ]);
    expect(fire(notify, 'RNP-007')).toEqual([]);
  });

  it('RNP-010 a worker relies on NOTIFY', () => {
    expect(targets(build(els, [['wrk.a', 'listens', 'ch.orders']]), 'RNP-010')).toEqual([
      ['ch.orders'],
    ]);
    expect(fire(build(els, [['svc.a', 'listens', 'ch.orders']]), 'RNP-010')).toEqual([]);
  });

  it('AP-012 applies to Postgres job queues and its fix sets deadLetter', () => {
    const p = build(els, [['wrk.a', 'processes', 'jobs.main']]);
    expect(targets(p, 'AP-012')).toEqual([['jobs.main']]);
    const [finding] = fire(p, 'AP-012');
    const fixed = applyOps(p, finding!.fixes[0]!.ops, catalog);
    expect(fixed.ok).toBe(true);
  });
});

describe('profile rules: request path and scaling', () => {
  it('RNP-008 a handler waits for a slow export', () => {
    const els: ElSpec[] = [
      ['svc.a', 'node.service'],
      ['ctl.reports', 'node.route-handler', { parentId: 'svc.a', name: 'Reports controller' }],
      ['ctl.orders', 'node.route-handler', { parentId: 'svc.a', name: 'Orders controller' }],
      ['uc.export', 'node.use-case', { parentId: 'svc.a', responsibilities: ['Export CSV'] }],
      ['ext.mail', 'gen.external', { qualities: { slow: true } }],
    ];
    const p = build(els, [
      ['ctl.orders', 'depends-on', 'uc.export'],
      ['uc.export', 'calls', 'ext.mail'],
    ]);
    expect(targets(p, 'RNP-008')).toEqual([['ctl.orders'], ['ctl.reports']]);
    const queued = build(
      [
        ...els.slice(0, 1),
        ...els.slice(2),
        ['db.main', 'pg.database'],
        ['jobs.main', 'pg.job-queue', { parentId: 'db.main' }],
      ],
      [
        ['ctl.orders', 'depends-on', 'uc.export'],
        ['uc.export', 'enqueues', 'jobs.main'],
      ],
    );
    expect(fire(queued, 'RNP-008')).toEqual([]);
  });

  it('RNP-009 a horizontally scaled service without a pooler', () => {
    const els: ElSpec[] = [
      ['svc.a', 'node.service', { qualities: { scaling: 'serverless' } }],
      ['pool.main', 'pg.pooler'],
      ...db,
    ];
    expect(targets(build(els, [['svc.a', 'reads', 'tbl.orders']]), 'RNP-009')).toEqual([['svc.a']]);
    const pooled = build(els, [
      ['svc.a', 'reads', 'tbl.orders'],
      ['svc.a', 'connects-via', 'pool.main'],
    ]);
    expect(fire(pooled, 'RNP-009')).toEqual([]);
  });

  it('RNP-020 the pools add up to more than the database allows', () => {
    const els: ElSpec[] = [
      ['svc.a', 'node.service', { properties: { instances: 6, poolSize: 10 } }],
      ['wrk.a', 'node.worker', { properties: { instances: 3, poolSize: 10 } }],
      ['pool.main', 'pg.pooler'],
      ...db,
    ];
    const p = build(els, [
      ['svc.a', 'writes', 'tbl.orders'],
      ['wrk.a', 'reads', 'tbl.orders'],
    ]);
    const [finding] = fire(p, 'RNP-020');
    expect(finding?.targetIds).toEqual(['db.main']);
    expect(finding?.message).toContain('Up to 90 connections');
    const pooled = build(els, [
      ['svc.a', 'writes', 'tbl.orders'],
      ['wrk.a', 'reads', 'tbl.orders'],
      ['pool.main', 'connects-via', 'db.main'],
    ]);
    expect(fire(pooled, 'RNP-020')).toEqual([]);
    const small = build(
      [['svc.a', 'node.service', { properties: { instances: 2, poolSize: 10 } }], ...db],
      [['svc.a', 'writes', 'tbl.orders']],
    );
    expect(fire(small, 'RNP-020')).toEqual([]);
  });

  it('RNP-021 CPU-heavy work on the event loop; worker threads are fine', () => {
    const els = (processModel?: string): ElSpec[] => [
      ['svc.a', 'node.service', processModel ? { properties: { processModel } } : {}],
      ['uc.thumbs', 'node.use-case', { parentId: 'svc.a', responsibilities: ['Resize images'] }],
    ];
    expect(targets(build(els()), 'RNP-021')).toEqual([['uc.thumbs']]);
    expect(fire(build(els('worker-threads')), 'RNP-021')).toEqual([]);
  });
});

describe('profile rules: concurrency control', () => {
  const els: ElSpec[] = [
    ['svc.a', 'node.service', { properties: { instances: 3 } }],
    ['svc.b', 'node.service'],
    ['uc.reserve', 'node.use-case', { parentId: 'svc.a', name: 'Reserve stock' }],
    ...db,
  ];

  it('RNP-019 concurrent writers of stock without concurrency control', () => {
    const p = build(els, [['uc.reserve', 'writes', 'tbl.orders']]);
    expect(fire(p, 'RNP-019')).toHaveLength(1);
    expect(fire(fix(p, 'RNP-019', 0), 'RNP-019')).toEqual([]);
    expect(fire(fix(p, 'RNP-019', 1), 'RNP-019')).toEqual([]);
    const single = build(
      [
        ['svc.b', 'node.service'],
        ['uc.reserve', 'node.use-case', { parentId: 'svc.b', name: 'Reserve stock' }],
        ...db,
      ],
      [['uc.reserve', 'writes', 'tbl.orders']],
    );
    expect(fire(single, 'RNP-019')).toEqual([]);
    const tagged = build(
      [
        ['svc.b', 'node.service'],
        ...db.slice(0, 3),
        ['tbl.orders', 'pg.table', { parentId: 'schema.orders', tags: ['contended'] }],
      ],
      [['svc.b', 'writes', 'tbl.orders']],
    );
    expect(fire(tagged, 'RNP-019')).toHaveLength(1);
  });

  it('RNP-022 serializable without retry, with a fix', () => {
    const p = build(els, [
      ['svc.b', 'writes', 'tbl.orders', { properties: { isolation: 'serializable' } }],
    ]);
    expect(fire(p, 'RNP-022')).toHaveLength(1);
    expect(fire(fix(p, 'RNP-022'), 'RNP-022')).toEqual([]);
  });

  it('RNP-023 a retried POST without an idempotency key', () => {
    const svc: ElSpec[] = [
      ['svc.a', 'node.service'],
      ['svc.b', 'node.service'],
      ['ctl.pay', 'node.route-handler', { parentId: 'svc.b' }],
      [
        'ep.pay',
        'node.endpoint',
        { parentId: 'ctl.pay', properties: { method: 'POST', path: '/payments' } },
      ],
      [
        'ep.get',
        'node.endpoint',
        { parentId: 'ctl.pay', properties: { method: 'GET', path: '/payments' } },
      ],
    ];
    const p = build(svc, [['svc.a', 'calls', 'ep.pay', { properties: { retries: 3 } }]]);
    expect(fire(p, 'RNP-023')).toHaveLength(1);
    expect(fire(fix(p, 'RNP-023'), 'RNP-023')).toEqual([]);
    expect(fire(build(svc, [['svc.a', 'calls', 'ep.pay']]), 'RNP-023')).toEqual([]);
    expect(
      fire(build(svc, [['svc.a', 'calls', 'ep.get', { properties: { retries: 3 } }]]), 'RNP-023'),
    ).toEqual([]);
  });
});

describe('profile rules: frontend', () => {
  it('RNP-011 the React app calls three Node services', () => {
    const svcs = (n: number): ElSpec[] =>
      Array.from({ length: n }, (_, i) => [`svc.s${i}`, 'node.service']);
    const calls = (n: number): RelSpec[] =>
      Array.from({ length: n }, (_, i) => ['app.web', 'calls', `svc.s${i}`]);
    expect(targets(build([['app.web', 'react.app'], ...svcs(3)], calls(3)), 'RNP-011')).toEqual([
      ['app.web'],
    ]);
    expect(fire(build([['app.web', 'react.app'], ...svcs(2)], calls(2)), 'RNP-011')).toEqual([]);
  });

  it('RNP-013 and RNP-014 Feature-Sliced Design imports', () => {
    const f = (id: string, fsdLayer: string): ElSpec => [
      id,
      'react.feature',
      { parentId: 'app.web', properties: { fsdLayer } },
    ];
    const els: ElSpec[] = [
      ['app.web', 'react.app'],
      f('fs.cart', 'features'),
      f('fs.checkout', 'features'),
      f('fs.user', 'entities'),
      f('fs.header', 'widgets'),
    ];
    expect(fire(build(els, [['fs.user', 'depends-on', 'fs.cart']]), 'RNP-013')).toHaveLength(1);
    expect(fire(build(els, [['fs.cart', 'depends-on', 'fs.user']]), 'RNP-013')).toEqual([]);
    expect(fire(build(els, [['fs.cart', 'depends-on', 'fs.checkout']]), 'RNP-014')).toHaveLength(1);
    expect(fire(build(els, [['fs.header', 'depends-on', 'fs.cart']]), 'RNP-014')).toEqual([]);
  });

  it('RNP-026 tokens in localStorage or a persisted auth store', () => {
    const p = build([
      ['app.web', 'react.app', { properties: { tokenStorage: 'local-storage' } }],
      [
        'st.auth',
        'react.client-store',
        { parentId: 'app.web', name: 'Auth store', properties: { persist: 'local-storage' } },
      ],
      [
        'st.ui',
        'react.client-store',
        { parentId: 'app.web', name: 'UI prefs', properties: { persist: 'local-storage' } },
      ],
    ]);
    expect(targets(p, 'RNP-026')).toEqual([['app.web'], ['st.auth']]);
    expect(targets(fix(p, 'RNP-026'), 'RNP-026')).toEqual([['st.auth']]);
  });
});

describe('profile rules: API and authentication', () => {
  const els = (
    endpointProps: Record<string, unknown>,
    handler: Record<string, unknown> = {},
  ): ElSpec[] => [
    ['app.web', 'react.app'],
    ['svc.api', 'node.service'],
    ['ctl.orders', 'node.route-handler', { parentId: 'svc.api', properties: handler }],
    [
      'ep.orders',
      'node.endpoint',
      { parentId: 'ctl.orders', properties: { path: '/orders', ...endpointProps } },
    ],
  ];
  const browserCalls: RelSpec[] = [['app.web', 'calls', 'svc.api']];

  it('RNP-015 a handler without validation, with a fix', () => {
    const p = build(els({ method: 'POST' }), browserCalls);
    expect(targets(p, 'RNP-015')).toEqual([['ctl.orders']]);
    expect(fire(fix(p, 'RNP-015'), 'RNP-015')).toEqual([]);
    expect(fire(build(els({ method: 'GET' })), 'RNP-015')).toEqual([]);
  });

  it('RNP-016 a public service without auth; the fix adds an auth middleware', () => {
    const p = build(els({ method: 'GET' }), browserCalls);
    expect(targets(p, 'RNP-016')).toEqual([['svc.api']]);
    expect(runRules(p, catalog).map((f) => f.ruleId)).not.toContain('AP-010');
    const fixed = fix(p, 'RNP-016');
    expect(fixed.model.elements.find((e) => e.kind === 'node.middleware')?.parentId).toBe(
      'svc.api',
    );
    expect(fire(fixed, 'RNP-016')).toEqual([]);
    expect(fire(build(els({ method: 'GET', auth: 'required' }), browserCalls), 'RNP-016')).toEqual(
      [],
    );
  });

  it('RNP-024 a public POST with auth none, with a fix', () => {
    const p = build(els({ method: 'POST', auth: 'none' }), browserCalls);
    expect(targets(p, 'RNP-024')).toEqual([['ep.orders']]);
    expect(fire(fix(p, 'RNP-024'), 'RNP-024')).toEqual([]);
    expect(fire(build(els({ method: 'POST', auth: 'none' })), 'RNP-024')).toEqual([]);
    expect(fire(build(els({ method: 'GET', auth: 'none' }), browserCalls), 'RNP-024')).toEqual([]);
  });

  it('RNP-025 a list endpoint without pagination, with a fix', () => {
    const p = build(els({ method: 'GET', returnsList: true }));
    expect(targets(p, 'RNP-025')).toEqual([['ep.orders']]);
    expect(fire(fix(p, 'RNP-025'), 'RNP-025')).toEqual([]);
  });
});
