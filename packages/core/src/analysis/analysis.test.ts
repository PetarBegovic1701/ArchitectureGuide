import { describe, expect, it } from 'vitest';
import { testCatalog } from '../test-support/fixtures';
import type { Model } from '../schema';
import {
  analysisContext,
  combineConfidence,
  dataOwnership,
  matchModel,
  relationSubject,
  resolveFacts,
  runAnalysisRules,
  selectSuggestions,
} from '.';
import type { Fact } from '.';

const fact = (f: Partial<Fact> & Pick<Fact, 'subject'>): Fact => ({
  type: 'deployable',
  data: {},
  evidence: [{ path: 'package.json', line: 1 }],
  confidence: 0.6,
  detector: 'test',
  ...f,
});

const facts: Fact[] = [
  fact({ subject: 'pkg:web', element: { kind: 't.app', name: 'Web', codePaths: ['apps/web'] } }),
  fact({
    subject: 'pkg:api',
    element: { kind: 't.service', name: 'API', codePaths: ['services/api'], tech: 'express' },
    evidence: [{ path: 'services/api/package.json', line: 3 }],
  }),
  fact({
    subject: 'pkg:api',
    detector: 'second',
    confidence: 0.5,
    element: { kind: 't.service', name: 'API', codePaths: ['services/api/src'] },
    evidence: [{ path: 'services/api/src/main.ts', line: 10 }],
  }),
  fact({
    type: 'module',
    subject: 'mod:api/orders',
    element: {
      kind: 't.module',
      name: 'Orders',
      parent: 'pkg:api',
      codePaths: ['services/api/src/orders'],
    },
  }),
  // A module without its service cannot stand alone: dropped.
  fact({
    type: 'module',
    subject: 'mod:lost',
    element: { kind: 't.module', name: 'Lost', parent: 'pkg:nope' },
  }),
  fact({ type: 'db-database', subject: 'db:main', element: { kind: 't.db', name: 'Main' } }),
  fact({
    type: 'http-call',
    subject: 'call:web->api',
    relation: { type: 'calls', from: 'pkg:web', to: 'pkg:api', protocol: 'http' },
  }),
  // Refused by the relation rules: a database does not call an app.
  fact({
    type: 'http-call',
    subject: 'x',
    relation: { type: 'calls', from: 'db:main', to: 'pkg:web' },
  }),
];

describe('resolveFacts', () => {
  const r = resolveFacts(facts, testCatalog);

  it('merges facts per subject with noisy-or confidence, code paths and evidence', () => {
    const api = r.candidates.elements.find((e) => e.id === r.subjects['pkg:api'])!;
    expect(api).toMatchObject({
      id: 'svc.api',
      kind: 't.service',
      tech: 'express',
      status: 'existing',
    });
    expect(api.codePaths).toEqual(['services/api', 'services/api/src']);
    expect(api.source).toMatchObject({ origin: 'inferred', confidence: 0.8, reviewed: false });
    expect(api.source!.evidence!.map((e) => e.detector)).toEqual(['test', 'second']);
    expect(combineConfidence([0.9, 0.9, 0.9])).toBe(0.99);
  });

  it('nests children, drops orphans that need a parent, and skips refused relations', () => {
    expect(r.candidates.elements.find((e) => e.name === 'Orders')?.parentId).toBe('svc.api');
    expect(r.subjects['mod:lost']).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('mod:lost'))).toBe(true);
    expect(r.candidates.relations).toMatchObject([
      { id: 'rel.app-web-calls-svc-api', type: 'calls', protocol: 'http', sourceId: 'app.web' },
    ]);
    expect(r.warnings.some((w) => w.startsWith('relation not allowed'))).toBe(true);
  });

  it('leaves out rejected subjects and relations', () => {
    const rejected = new Set(['db:main', relationSubject('calls', 'pkg:web', 'pkg:api')]);
    const again = resolveFacts(facts, testCatalog, { rejected });
    expect(again.subjects['db:main']).toBeUndefined();
    expect(again.candidates.relations).toEqual([]);
  });
});

describe('dataOwnership', () => {
  const table = (name: string, model: string): Fact =>
    fact({
      type: 'db-table',
      subject: `table:app.${name}`,
      data: { schema: 'app', table: name, model },
      element: { kind: 't.db', name, parent: 'schema:app' },
    });
  const use = (deployable: string, target: string, op: 'read' | 'write', line: number): Fact =>
    fact({
      type: 'orm-usage',
      subject: `${deployable}:${target}:${line}`,
      data: { deployable, target, op, orm: 'prisma' },
      evidence: [{ path: `${deployable}.ts`, line }],
    });

  it('resolves models to tables, collects writers per schema, and finds the migration owner', () => {
    const { ownership, facts: out } = dataOwnership([
      table('orders', 'Order'),
      table('users', 'User'),
      use('pkg:orders', 'order', 'write', 1),
      use('pkg:orders', 'User', 'read', 2),
      use('pkg:billing', 'orders', 'write', 3),
      use('pkg:billing', 'Invoice', 'write', 4),
      fact({
        type: 'migrations',
        subject: 'm',
        data: { deployable: 'pkg:orders', tables: ['orders', 'users'] },
      }),
    ]);
    expect(ownership.tables['table:app.orders']!.writers.map((w) => w.deployable)).toEqual([
      'pkg:billing',
      'pkg:orders',
    ]);
    expect(ownership.schemas['schema:app']).toMatchObject({
      owners: [{ deployable: 'pkg:orders' }],
      writers: ['pkg:billing', 'pkg:orders'],
    });
    expect(ownership.unresolved).toMatchObject([{ target: 'Invoice' }]);
    expect(out.map((f) => f.relation)).toEqual([
      { type: 'writes', from: 'pkg:billing', to: 'table:app.orders', via: 'prisma' },
      { type: 'writes', from: 'pkg:orders', to: 'table:app.orders', via: 'prisma' },
      { type: 'reads', from: 'pkg:orders', to: 'table:app.users', via: 'prisma' },
      { type: 'migrates', from: 'pkg:orders', to: 'schema:app' },
    ]);
  });
});

describe('matchModel and selectSuggestions', () => {
  const { candidates } = resolveFacts(facts, testCatalog);
  const model: Model = {
    elements: [
      // Same kind and overlapping code path, other name and ID.
      {
        id: 'svc.backend',
        kind: 't.service',
        name: 'Backend',
        status: 'existing',
        codePaths: ['services/api/src'],
      },
      // In the model as existing, not in the code.
      { id: 'svc.legacy', kind: 't.service', name: 'Legacy', status: 'existing' },
      { id: 'svc.next', kind: 't.service', name: 'Next', status: 'planned' },
    ],
    relations: [],
  };
  const diff = matchModel(model, candidates);

  it('matches by ID, code path or name in the same parent, and suggests the rest', () => {
    expect(diff.matches).toEqual({ 'svc.api': 'svc.backend' });
    expect(diff.newInCode.sort()).toEqual(['app.web', 'db.main', 'mod.orders']);
    expect(diff.missingInCode).toEqual(['svc.legacy']);
    expect(diff.changed).toEqual([{ id: 'svc.backend', fields: ['codePaths'] }]);
    const added = diff.suggestedOps.flatMap((o) => (o.op === 'addElement' ? [o.element] : []));
    expect(added.find((e) => e.id === 'mod.orders')?.parentId).toBe('svc.backend');
    expect(diff.suggestedOps).toContainEqual(
      expect.objectContaining({
        op: 'addRelation',
        relation: expect.objectContaining({ sourceId: 'app.web', targetId: 'svc.backend' }),
      }),
    );
  });

  it('applies all, a selection, or what is confident enough, marked reviewed when asked', () => {
    expect(selectSuggestions(diff)).toHaveLength(diff.suggestedOps.length);
    const some = selectSuggestions(diff, { accept: ['db.main'], reviewed: true });
    expect(some).toMatchObject([
      { op: 'addElement', element: { id: 'db.main', source: { reviewed: true } } },
    ]);
    // The relation needs app.web, which is below the bar.
    expect(selectSuggestions(diff, { minConfidence: 0.7 }).map((o) => o.op)).toEqual([
      'updateElement',
    ]);
  });

  it('runs analysis rules with subjects mapped to candidate IDs', () => {
    const r = resolveFacts(facts, testCatalog);
    const ctx = analysisContext(
      facts,
      r.candidates,
      r.subjects,
      dataOwnership(facts).ownership,
      testCatalog,
    );
    const findings = runAnalysisRules(
      [
        {
          id: 'T-1',
          title: 'Test',
          severity: 'warning',
          rationale: '',
          check: (c) =>
            c.of('http-call').map((f) => ({
              targetIds: [c.idOf(f.relation!.from)],
              message: 'x',
              evidence: f.evidence,
            })),
        },
      ],
      ctx,
    );
    expect(findings.map((f) => f.targetIds[0])).toEqual(['app.web', 'db.main']);
    expect(findings[0]!.evidence).toEqual([{ path: 'package.json', line: 1 }]);
  });
});
