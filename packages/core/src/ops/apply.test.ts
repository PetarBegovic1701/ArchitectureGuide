import { describe, expect, it } from 'vitest';
import { applyOps, validateOps } from '.';
import type { ApplyResult } from '.';
import { serializeProject } from '../serialize';
import type { Op, Project } from '../schema';
import { NOW, el, rel, sampleProject, testCatalog } from '../test-support/fixtures';

function apply(p: Project, ops: unknown[]): ApplyResult {
  return applyOps(p, ops, testCatalog);
}

function ok(p: Project, ops: unknown[]): { project: Project; inverse: Op[] } {
  const r = apply(p, ops);
  if (!r.ok) throw new Error(`expected success, got ${JSON.stringify(r.errors)}`);
  return r;
}

function err(p: Project, ops: unknown[]) {
  const r = apply(p, ops);
  if (r.ok) throw new Error('expected failure');
  return r.errors[0]!;
}

/** Applies ops, then their inverse, and expects the original project back. */
function expectUndoable(p: Project, ops: unknown[]): Project {
  const { project, inverse } = ok(p, ops);
  const back = ok(project, inverse);
  expect(serializeProject(back.project)).toBe(serializeProject(p));
  return project;
}

describe('applyOps basics', () => {
  it('does not mutate the input project', () => {
    const p = sampleProject();
    const before = serializeProject(p);
    ok(p, [{ op: 'addElement', element: el('db.other', 't.db') }]);
    expect(serializeProject(p)).toBe(before);
  });

  it('is all or nothing and reports the failing index', () => {
    const p = sampleProject();
    const e = err(p, [
      { op: 'addElement', element: el('db.other', 't.db') },
      { op: 'addElement', element: el('db.other', 't.db') },
    ]);
    expect(e).toMatchObject({ index: 1, code: 'ID_EXISTS', itemId: 'db.other' });
    expect(p.model.elements.some((x) => x.id === 'db.other')).toBe(false);
  });

  it('lets later ops use items added earlier in the same batch', () => {
    const p = expectUndoable(sampleProject(), [
      { op: 'addElement', element: el('svc.billing', 't.service') },
      { op: 'addRelation', relation: rel('rel.billing-db', 'reads', 'svc.billing', 'db.main') },
    ]);
    expect(p.model.relations.map((r) => r.id)).toContain('rel.billing-db');
  });

  it('rejects ops that do not match the schema', () => {
    expect(err(sampleProject(), [{ op: 'addElement', element: { id: 'Bad ID' } }])).toMatchObject({
      code: 'SCHEMA_INVALID',
      index: 0,
    });
  });

  it('validateOps returns the errors without applying', () => {
    expect(
      validateOps(sampleProject(), [{ op: 'removeElement', id: 'nope' }], testCatalog),
    ).toMatchObject([{ code: 'ID_NOT_FOUND' }]);
    expect(validateOps(sampleProject(), [], testCatalog)).toEqual([]);
  });
});

describe('elements', () => {
  it('adds an element', () => {
    expectUndoable(sampleProject(), [
      { op: 'addElement', element: el('mod.billing', 't.module', { parentId: 'svc.api' }) },
    ]);
  });

  it('refuses unknown kinds, missing parents, bad nesting and bad properties', () => {
    const p = sampleProject();
    expect(err(p, [{ op: 'addElement', element: el('x.y', 'x.unknown') }]).code).toBe(
      'UNKNOWN_KIND',
    );
    expect(
      err(p, [{ op: 'addElement', element: el('mod.x', 't.module', { parentId: 'svc.nope' }) }])
        .code,
    ).toBe('ID_NOT_FOUND');
    expect(err(p, [{ op: 'addElement', element: el('mod.x', 't.module') }]).code).toBe(
      'NESTING_NOT_ALLOWED',
    );
    expect(
      err(p, [{ op: 'addElement', element: el('svc.x', 't.service', { parentId: 'db.main' }) }])
        .code,
    ).toBe('NESTING_NOT_ALLOWED');
    expect(
      err(p, [
        {
          op: 'addElement',
          element: el('svc.x', 't.service', { properties: { framework: 'rails' } }),
        },
      ]),
    ).toMatchObject({ code: 'PROPERTY_INVALID', itemId: 'svc.x' });
  });

  it('shares one ID space between elements and relations', () => {
    expect(
      err(sampleProject(), [{ op: 'addElement', element: el('rel.web-api', 't.db') }]).code,
    ).toBe('ID_EXISTS');
  });

  it('updates fields and removes a field with null', () => {
    const p = expectUndoable(sampleProject(), [
      {
        op: 'updateElement',
        id: 'svc.api',
        patch: { name: 'API', tech: 'Fastify', properties: null },
      },
    ]);
    const svc = p.model.elements.find((e) => e.id === 'svc.api')!;
    expect(svc).toMatchObject({ name: 'API', tech: 'Fastify' });
    expect(svc).not.toHaveProperty('properties');
  });

  it('refuses to patch id or parentId, and refuses invalid results', () => {
    const p = sampleProject();
    expect(
      err(p, [{ op: 'updateElement', id: 'svc.api', patch: { id: 'svc.x' } }]).hint ?? '',
    ).toBe('');
    expect(
      err(p, [{ op: 'updateElement', id: 'svc.api', patch: { id: 'svc.x' } }]).message,
    ).toMatch(/renameId/);
    expect(
      err(p, [{ op: 'updateElement', id: 'svc.api', patch: { parentId: 'x' } }]).message,
    ).toMatch(/moveElement/);
    expect(err(p, [{ op: 'updateElement', id: 'svc.api', patch: { name: '' } }]).code).toBe(
      'SCHEMA_INVALID',
    );
    expect(err(p, [{ op: 'updateElement', id: 'svc.api', patch: { status: null } }]).code).toBe(
      'SCHEMA_INVALID',
    );
  });

  it('re-checks nesting and relations when the kind changes', () => {
    const p = sampleProject();
    // svc.api has children: a database cannot hold modules.
    expect(err(p, [{ op: 'updateElement', id: 'svc.api', patch: { kind: 't.db' } }])).toMatchObject(
      {
        code: 'NESTING_NOT_ALLOWED',
        itemId: 'mod.orders',
      },
    );
    // db.main is written by ad.pg: a queue cannot be written.
    expect(err(p, [{ op: 'updateElement', id: 'db.main', patch: { kind: 't.queue' } }]).code).toBe(
      'RELATION_NOT_ALLOWED',
    );
  });

  it('refuses to remove an element with dependents unless cascade is set', () => {
    expect(err(sampleProject(), [{ op: 'removeElement', id: 'svc.api' }])).toMatchObject({
      code: 'HAS_DEPENDENTS',
      hint: expect.stringMatching(/cascade/),
    });
  });

  it('cascade removes children, relations, view items and anchored annotations, and undoes fully', () => {
    const p = expectUndoable(sampleProject(), [
      { op: 'removeElement', id: 'svc.api', cascade: true },
    ]);
    expect(p.model.elements.map((e) => e.id).sort()).toEqual(['app.web', 'db.main']);
    expect(p.model.relations).toEqual([]);
    expect(p.views[0]!.nodes.map((n) => n.elementId)).toEqual(['app.web', 'db.main']);
    expect(p.views[0]!.edges).toEqual([]);
    expect(p.views[0]!.annotations).toEqual([]);
  });

  it('removing an element without dependents also drops its view node', () => {
    const p = expectUndoable(sampleProject(), [
      { op: 'removeRelation', id: 'rel.pg-db' },
      { op: 'removeElement', id: 'db.main' },
    ]);
    expect(p.views[0]!.nodes.map((n) => n.elementId)).toEqual(['app.web', 'svc.api']);
  });

  it('moves an element and refuses cycles and bad parents', () => {
    const base = sampleProject();
    expectUndoable(base, [
      { op: 'addElement', element: el('mod.shared', 't.module', { parentId: 'svc.api' }) },
      { op: 'moveElement', id: 'ad.pg', parentId: 'mod.shared' },
    ]);
    expect(err(base, [{ op: 'moveElement', id: 'mod.orders', parentId: 'db.main' }]).code).toBe(
      'NESTING_NOT_ALLOWED',
    );
    // ad.pg sits inside mod.orders, so this would put mod.orders inside itself.
    expect(err(base, [{ op: 'moveElement', id: 'mod.orders', parentId: 'ad.pg' }]).code).toBe(
      'NESTING_CYCLE',
    );
    expect(err(base, [{ op: 'moveElement', id: 'mod.orders', parentId: 'mod.orders' }]).code).toBe(
      'NESTING_CYCLE',
    );
    const nested = ok(base, [
      { op: 'addElement', element: el('mod.inner', 't.module', { parentId: 'mod.orders' }) },
    ]);
    expect(
      err(nested.project, [{ op: 'moveElement', id: 'mod.orders', parentId: 'mod.inner' }]).code,
    ).toBe('NESTING_CYCLE');
    expect(err(base, [{ op: 'moveElement', id: 'mod.orders', parentId: null }]).code).toBe(
      'NESTING_NOT_ALLOWED',
    );
  });

  it('moves to top level and back', () => {
    const base = sampleProject();
    const grouped = ok(base, [
      { op: 'addElement', element: el('ctx.sales', 'group.context') },
      { op: 'moveElement', id: 'svc.api', parentId: 'ctx.sales' },
    ]).project;
    const top = expectUndoable(grouped, [{ op: 'moveElement', id: 'svc.api', parentId: null }]);
    expect(top.model.elements.find((e) => e.id === 'svc.api')).not.toHaveProperty('parentId');
  });
});

describe('relations', () => {
  it('refuses forbidden relations and offers the flipped relation as a fix', () => {
    const e = err(sampleProject(), [
      { op: 'addRelation', relation: rel('rel.bad', 'calls', 'db.main', 'svc.api') },
    ]);
    expect(e.code).toBe('RELATION_NOT_ALLOWED');
    expect(e.fix).toEqual([
      {
        op: 'addRelation',
        relation: expect.objectContaining({
          type: 'reads',
          sourceId: 'svc.api',
          targetId: 'db.main',
        }),
      },
    ]);
    const fixed = ok(sampleProject(), e.fix!);
    expect(fixed.project.model.relations.some((r) => r.id === 'rel.svc-api-reads-db-main')).toBe(
      true,
    );
  });

  it('refuses unknown types, missing ends and self relations', () => {
    const p = sampleProject();
    expect(
      err(p, [{ op: 'addRelation', relation: rel('rel.x', 'teleports', 'app.web', 'svc.api') }])
        .code,
    ).toBe('UNKNOWN_RELATION');
    expect(
      err(p, [{ op: 'addRelation', relation: rel('rel.x', 'calls', 'app.web', 'svc.nope') }]).code,
    ).toBe('ID_NOT_FOUND');
    expect(
      err(p, [{ op: 'addRelation', relation: rel('rel.x', 'calls', 'svc.api', 'svc.api') }]).code,
    ).toBe('SELF_RELATION');
  });

  it('updates a relation and re-checks a changed type', () => {
    expectUndoable(sampleProject(), [
      {
        op: 'updateRelation',
        id: 'rel.web-api',
        patch: { label: 'POST /orders', protocol: 'http' },
      },
    ]);
    expect(
      err(sampleProject(), [{ op: 'updateRelation', id: 'rel.pg-db', patch: { type: 'calls' } }])
        .code,
    ).toBe('RELATION_NOT_ALLOWED');
  });

  it('removing a relation drops its view edge and anchored annotations', () => {
    const base = ok(sampleProject(), [
      {
        op: 'upsertAnnotation',
        viewId: 'main',
        annotation: {
          id: 'edge-note',
          kind: 'callout',
          text: 'hot path',
          anchor: { relationId: 'rel.web-api' },
          createdAt: NOW,
        },
      },
      {
        op: 'updateView',
        id: 'main',
        patch: { scenario: { steps: [{ relationId: 'rel.web-api' }] } },
      },
    ]).project;
    const p = expectUndoable(base, [{ op: 'removeRelation', id: 'rel.web-api' }]);
    expect(p.views[0]!.edges.map((e) => e.relationId)).toEqual(['rel.pg-db']);
    expect(p.views[0]!.annotations.map((a) => a.id)).toEqual(['note-1']);
    expect(p.views[0]!.scenario).toEqual({ steps: [] });
  });
});

describe('renameId', () => {
  it('renames an element everywhere and undoes', () => {
    const base = ok(sampleProject(), [
      {
        op: 'upsertSuppression',
        suppression: {
          ruleId: 'AP-016',
          targetIds: ['svc.api'],
          reason: 'Known and accepted for now',
          createdAt: NOW,
        },
      },
      { op: 'addElement', element: el('db.audit', 't.db', { properties: { ownedBy: 'svc.api' } }) },
      {
        op: 'addView',
        view: {
          id: 'inside-api',
          name: 'Inside API',
          kind: 'component',
          scopeElementId: 'svc.api',
          nodes: [],
          edges: [],
          annotations: [],
        },
      },
    ]).project;
    const p = expectUndoable(base, [{ op: 'renameId', from: 'svc.api', to: 'svc.orders' }]);
    const json = serializeProject(p);
    expect(json).not.toContain('"svc.api"');
    expect(p.model.elements.find((e) => e.id === 'mod.orders')!.parentId).toBe('svc.orders');
    expect(p.model.relations.find((r) => r.id === 'rel.web-api')!.targetId).toBe('svc.orders');
    expect(p.views.find((v) => v.id === 'inside-api')!.scopeElementId).toBe('svc.orders');
    expect(p.notes[0]!.linkedIds).toEqual(['svc.orders']);
    expect(p.settings.suppressions[0]!.targetIds).toEqual(['svc.orders']);
    expect(p.model.elements.find((e) => e.id === 'db.audit')!.properties).toEqual({
      ownedBy: 'svc.orders',
    });
  });

  it('renames a relation and refuses taken or invalid targets', () => {
    expectUndoable(sampleProject(), [
      { op: 'renameId', from: 'rel.web-api', to: 'rel.web-calls-api' },
    ]);
    expect(err(sampleProject(), [{ op: 'renameId', from: 'svc.api', to: 'db.main' }]).code).toBe(
      'ID_EXISTS',
    );
    expect(err(sampleProject(), [{ op: 'renameId', from: 'nope', to: 'x.y' }]).code).toBe(
      'ID_NOT_FOUND',
    );
  });
});

describe('views, annotations, notes, decisions, settings', () => {
  it('adds, updates and removes views', () => {
    const view = {
      id: 'backend',
      name: 'Backend',
      kind: 'container',
      nodes: [{ elementId: 'svc.api', x: 0, y: 0 }],
      edges: [],
      annotations: [],
    };
    expectUndoable(sampleProject(), [{ op: 'addView', view }]);
    expectUndoable(sampleProject(), [
      { op: 'updateView', id: 'main', patch: { name: 'Overview' } },
    ]);
    expectUndoable(sampleProject(), [{ op: 'removeView', id: 'main' }]);
    expect(
      err(sampleProject(), [{ op: 'updateView', id: 'main', patch: { nodes: [] } }]).code,
    ).toBe('SCHEMA_INVALID');
    expect(err(sampleProject(), [{ op: 'addView', view: { ...view, id: 'main' } }]).code).toBe(
      'ID_EXISTS',
    );
  });

  it('sets and removes view nodes and edges', () => {
    expectUndoable(sampleProject(), [
      { op: 'setViewNode', viewId: 'main', node: { elementId: 'svc.api', x: 10, y: 20 } },
    ]);
    expectUndoable(sampleProject(), [
      { op: 'setViewNode', viewId: 'main', node: { elementId: 'mod.orders', x: 10, y: 20 } },
    ]);
    expectUndoable(sampleProject(), [
      { op: 'removeViewNode', viewId: 'main', elementId: 'svc.api' },
    ]);
    expectUndoable(sampleProject(), [
      {
        op: 'setViewEdge',
        viewId: 'main',
        edge: { relationId: 'rel.pg-port', waypoints: [{ x: 1, y: 2 }] },
      },
    ]);
    expectUndoable(sampleProject(), [
      { op: 'removeViewEdge', viewId: 'main', relationId: 'rel.pg-db' },
    ]);
    expect(
      err(sampleProject(), [
        { op: 'setViewNode', viewId: 'main', node: { elementId: 'nope', x: 0, y: 0 } },
      ]).code,
    ).toBe('ID_NOT_FOUND');
  });

  it('upserts and removes annotations, notes, decisions, suppressions and change sets', () => {
    const decision = {
      id: 'adr-001',
      title: 'Use Postgres',
      status: 'accepted',
      context: 'c',
      decision: 'd',
      consequences: 'e',
      linkedIds: ['db.main'],
      date: '2026-10-27',
    };
    expectUndoable(sampleProject(), [{ op: 'upsertDecision', decision }]);
    expectUndoable(ok(sampleProject(), [{ op: 'upsertDecision', decision }]).project, [
      { op: 'removeDecision', id: 'adr-001' },
    ]);
    expectUndoable(sampleProject(), [
      {
        op: 'upsertNote',
        note: {
          id: 'glossary',
          title: 'Glossary',
          body: 'Order: a paid cart',
          linkedIds: [],
          updatedAt: NOW,
        },
      },
    ]);
    expectUndoable(sampleProject(), [{ op: 'removeNote', id: 'glossary' }]);
    expectUndoable(sampleProject(), [{ op: 'removeAnnotation', viewId: 'main', id: 'note-1' }]);
    const suppression = {
      ruleId: 'AP-016',
      targetIds: ['db.main', 'app.web'],
      reason: 'Placeholder until the design is done',
      createdAt: NOW,
    };
    const suppressed = expectUndoable(sampleProject(), [{ op: 'upsertSuppression', suppression }]);
    expectUndoable(suppressed, [
      { op: 'removeSuppression', ruleId: 'AP-016', targetIds: ['app.web', 'db.main'] },
    ]);
    const changeSet = {
      id: 'cs.pay',
      name: 'Payments',
      description: '',
      status: 'draft',
      baseRevision: 0,
      createdAt: NOW,
      ops: [{ op: 'addElement', element: el('svc.pay', 't.service') }],
    };
    expectUndoable(sampleProject(), [{ op: 'upsertChangeSet', changeSet }]);
    expectUndoable(ok(sampleProject(), [{ op: 'upsertChangeSet', changeSet }]).project, [
      { op: 'removeChangeSet', id: 'cs.pay' },
    ]);
  });

  it('refuses a suppression without a real reason', () => {
    const suppression = {
      ruleId: 'AP-016',
      targetIds: ['db.main'],
      reason: 'because',
      createdAt: NOW,
    };
    expect(err(sampleProject(), [{ op: 'upsertSuppression', suppression }]).code).toBe(
      'SCHEMA_INVALID',
    );
  });

  it('refuses annotations anchored to missing items', () => {
    const annotation = {
      id: 'a',
      kind: 'sticky',
      text: 'x',
      anchor: { elementId: 'nope' },
      createdAt: NOW,
    };
    expect(
      err(sampleProject(), [{ op: 'upsertAnnotation', viewId: 'main', annotation }]).code,
    ).toBe('ID_NOT_FOUND');
  });

  it('updates project meta and settings with validation', () => {
    expectUndoable(sampleProject(), [
      { op: 'updateProject', patch: { name: 'Shop 2', description: 'New' } },
    ]);
    expectUndoable(sampleProject(), [
      { op: 'updateSettings', patch: { rulePacks: ['core', 'hexagonal'], codeRoot: '..' } },
    ]);
    expect(err(sampleProject(), [{ op: 'updateProject', patch: { name: null } }]).code).toBe(
      'SCHEMA_INVALID',
    );
    expect(err(sampleProject(), [{ op: 'updateProject', patch: { revision: 9 } }]).code).toBe(
      'SCHEMA_INVALID',
    );
    expect(
      err(sampleProject(), [{ op: 'updateSettings', patch: { thresholds: { fanOut: -1 } } }]).code,
    ).toBe('SCHEMA_INVALID');
  });
});

describe('relation properties', () => {
  it('accepts valid properties and refuses invalid ones', () => {
    expectUndoable(sampleProject(), [
      {
        op: 'updateRelation',
        id: 'rel.pg-db',
        patch: {
          properties: { concurrencyControl: 'optimistic-version', isolation: 'read-committed' },
        },
      },
    ]);
    expect(
      err(sampleProject(), [
        { op: 'updateRelation', id: 'rel.pg-db', patch: { properties: { isolation: 'chaos' } } },
      ]),
    ).toMatchObject({ code: 'PROPERTY_INVALID', itemId: 'rel.pg-db' });
    expect(
      err(sampleProject(), [
        {
          op: 'addRelation',
          relation: { ...rel('rel.x', 'calls', 'app.web', 'svc.api'), properties: { retries: -1 } },
        },
      ]).code,
    ).toBe('PROPERTY_INVALID');
  });
});

describe('tours', () => {
  const tour = {
    id: 'welcome',
    title: 'Welcome',
    audience: 'beginner',
    steps: [
      {
        id: 's1',
        title: 'The web app',
        body: 'Start here.',
        viewId: 'main',
        elementIds: ['app.web'],
        relationIds: [],
      },
      {
        id: 's2',
        title: 'The API',
        body: '',
        elementIds: ['svc.api', 'db.main'],
        relationIds: ['rel.web-api'],
      },
    ],
  };

  it('upserts and removes a tour', () => {
    const p = expectUndoable(sampleProject(), [{ op: 'upsertTour', tour }]);
    expect(p.tours).toHaveLength(1);
    expectUndoable(p, [{ op: 'removeTour', id: 'welcome' }]);
  });

  it('refuses tours that point at missing items', () => {
    const bad = { ...tour, steps: [{ ...tour.steps[0]!, elementIds: ['nope'] }] };
    expect(err(sampleProject(), [{ op: 'upsertTour', tour: bad }]).code).toBe('ID_NOT_FOUND');
  });

  it('keeps tours consistent when items are removed or renamed, and undoes', () => {
    const base = ok(sampleProject(), [{ op: 'upsertTour', tour }]).project;
    const removed = expectUndoable(base, [{ op: 'removeElement', id: 'svc.api', cascade: true }]);
    expect(removed.tours[0]!.steps[1]).toMatchObject({ elementIds: ['db.main'], relationIds: [] });
    const noView = expectUndoable(base, [{ op: 'removeView', id: 'main' }]);
    expect(noView.tours[0]!.steps[0]).not.toHaveProperty('viewId');
    const renamed = expectUndoable(base, [
      { op: 'renameId', from: 'rel.web-api', to: 'rel.web-calls-api' },
    ]);
    expect(renamed.tours[0]!.steps[1]!.relationIds).toEqual(['rel.web-calls-api']);
  });
});
