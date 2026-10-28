import { describe, expect, it } from 'vitest';
import { applyOps } from '../ops';
import { createProject } from '../project';
import type { Finding } from '../rules';
import type { ModelOp, Project } from '../schema';
import { testCatalog } from '../test-support/fixtures';
import {
  catalogSummary,
  countFindings,
  newFindings,
  placeMissingOps,
  removeItemsOps,
  suggestKinds,
  upsertElementsOps,
  upsertRelationsOps,
} from '.';

const NOW = '2026-10-28T00:00:00.000Z';
const empty = () => createProject({ id: 'p', name: 'P', profile: 'test', now: NOW });
const apply = (p: Project, ops: ModelOp[]) => {
  const r = applyOps(p, ops, testCatalog);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.project;
};

describe('upsertElementsOps', () => {
  it('creates elements with readable IDs, and later inputs can use earlier IDs', () => {
    const r = upsertElementsOps(empty(), testCatalog, [
      { kind: 't.service', name: 'Orders API' },
      { kind: 't.module', name: 'Billing', parentId: 'svc.orders-api' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.ids).toEqual(['svc.orders-api', 'mod.billing']);
    const p = apply(empty(), r.ops);
    expect(p.model.elements.find((e) => e.id === 'mod.billing')?.parentId).toBe('svc.orders-api');
    expect(p.model.elements[0]?.status).toBe('planned');
  });

  it('updates and moves an existing element, and refuses a kind change', () => {
    let p = apply(
      empty(),
      upsertElementsOps(empty(), testCatalog, [
        { kind: 't.service', name: 'A', id: 'svc.a' },
        { kind: 't.service', name: 'B', id: 'svc.b' },
        { kind: 't.module', name: 'M', id: 'mod.m', parentId: 'svc.a' },
      ]).ops,
    );
    const r = upsertElementsOps(p, testCatalog, [
      { id: 'mod.m', kind: 't.module', name: 'Billing', parentId: 'svc.b' },
      { id: 'svc.a', kind: 't.module', name: 'A' },
    ]);
    expect(r.ops.map((o) => o.op)).toEqual(['updateElement', 'moveElement']);
    expect(r.errors).toMatchObject([{ index: 1, code: 'SCHEMA_INVALID', itemId: 'svc.a' }]);
    p = apply(p, r.ops);
    expect(p.model.elements.find((e) => e.id === 'mod.m')).toMatchObject({
      name: 'Billing',
      parentId: 'svc.b',
    });
  });

  it('suggests concepts for an unknown kind and refuses bad IDs', () => {
    const r = upsertElementsOps(empty(), testCatalog, [
      { kind: 'node.service', name: 'Service' },
      { kind: 't.service', name: 'X', id: 'Bad ID' },
    ]);
    expect(r.errors[0]).toMatchObject({ code: 'UNKNOWN_KIND' });
    expect(r.errors[0]!.hint).toContain('t.service');
    expect(r.errors[1]).toMatchObject({ code: 'SCHEMA_INVALID', index: 1 });
    expect(suggestKinds(testCatalog, 'service')).toContain('t.service');
  });
});

describe('upsertRelationsOps', () => {
  const base = () =>
    apply(
      empty(),
      upsertElementsOps(empty(), testCatalog, [
        { kind: 't.app', name: 'Web', id: 'app.web' },
        { kind: 't.service', name: 'API', id: 'svc.api' },
        { kind: 't.db', name: 'DB', id: 'db.main' },
      ]).ops,
    );

  it('picks the only valid type and names the relation', () => {
    const r = upsertRelationsOps(base(), testCatalog, [
      { sourceId: 'app.web', targetId: 'svc.api' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.ids).toEqual(['rel.app-web-calls-svc-api']);
    expect(apply(base(), r.ops).model.relations[0]?.type).toBe('calls');
  });

  it('asks for a type when several fit, and explains refused pairs and unknown ends', () => {
    const r = upsertRelationsOps(base(), testCatalog, [
      { sourceId: 'svc.api', targetId: 'db.main' },
      { sourceId: 'db.main', targetId: 'app.web' },
      { sourceId: 'svc.api', targetId: 'svc.nope' },
    ]);
    expect(r.errors[0]!.message).toMatch(/Several relation types fit .*reads.*writes/);
    expect(r.errors[1]).toMatchObject({ code: 'RELATION_NOT_ALLOWED', index: 1 });
    expect(r.errors[2]).toMatchObject({ code: 'ID_NOT_FOUND', itemId: 'svc.nope' });
  });

  it('updates an existing relation but never moves its ends', () => {
    const p = apply(
      base(),
      upsertRelationsOps(base(), testCatalog, [
        { sourceId: 'svc.api', targetId: 'db.main', type: 'writes', id: 'rel.w' },
      ]).ops,
    );
    const ok = upsertRelationsOps(p, testCatalog, [
      { id: 'rel.w', sourceId: 'svc.api', targetId: 'db.main', label: 'orders' },
    ]);
    expect(ok.ops).toEqual([{ op: 'updateRelation', id: 'rel.w', patch: { label: 'orders' } }]);
    const moved = upsertRelationsOps(p, testCatalog, [
      { id: 'rel.w', sourceId: 'app.web', targetId: 'db.main' },
    ]);
    expect(moved.errors[0]!.code).toBe('SCHEMA_INVALID');
  });
});

describe('removeItemsOps', () => {
  it('removes relations first, children once, and reports unknown IDs', () => {
    const p = apply(empty(), [
      ...upsertElementsOps(empty(), testCatalog, [
        { kind: 't.service', name: 'A', id: 'svc.a' },
        { kind: 't.module', name: 'M', id: 'mod.m', parentId: 'svc.a' },
        { kind: 't.app', name: 'W', id: 'app.w' },
      ]).ops,
      {
        op: 'addRelation',
        relation: {
          id: 'rel.x',
          type: 'calls',
          sourceId: 'app.w',
          targetId: 'svc.a',
          status: 'planned',
        },
      },
    ]);
    const r = removeItemsOps(p, ['mod.m', 'svc.a', 'rel.x', 'nope']);
    expect(r.ops).toEqual([
      { op: 'removeRelation', id: 'rel.x' },
      { op: 'removeElement', id: 'svc.a', cascade: true },
    ]);
    expect(r.errors).toMatchObject([{ code: 'ID_NOT_FOUND', itemId: 'nope' }]);
    expect(apply(p, r.ops).model.elements.map((e) => e.id)).toEqual(['app.w']);
  });
});

describe('placeMissingOps', () => {
  it('shows new elements and relations in the view without overlaps', () => {
    let p = apply(empty(), [
      ...upsertElementsOps(empty(), testCatalog, [
        { kind: 't.service', name: 'A', id: 'svc.a' },
        { kind: 't.module', name: 'M1', id: 'mod.m1', parentId: 'svc.a' },
        { kind: 't.module', name: 'M2', id: 'mod.m2', parentId: 'svc.a' },
        { kind: 't.app', name: 'W', id: 'app.w' },
      ]).ops,
      {
        op: 'addRelation',
        relation: {
          id: 'rel.x',
          type: 'calls',
          sourceId: 'app.w',
          targetId: 'svc.a',
          status: 'planned',
        },
      },
    ]);
    p = apply(p, placeMissingOps(p, testCatalog));
    const view = p.views[0]!;
    expect(view.nodes.map((n) => n.elementId).sort()).toEqual([
      'app.w',
      'mod.m1',
      'mod.m2',
      'svc.a',
    ]);
    expect(view.edges.map((e) => e.relationId)).toEqual(['rel.x']);
    const m1 = view.nodes.find((n) => n.elementId === 'mod.m1')!;
    const m2 = view.nodes.find((n) => n.elementId === 'mod.m2')!;
    expect(m2.x).toBeGreaterThan(m1.x);
    const a = view.nodes.find((n) => n.elementId === 'svc.a')!;
    const w = view.nodes.find((n) => n.elementId === 'app.w')!;
    expect(w.x).toBeGreaterThan(a.x);
    // Nothing left to place.
    expect(placeMissingOps(p, testCatalog)).toEqual([]);
  });
});

describe('findings helpers and catalog summary', () => {
  const f = (ruleId: string, targetIds: string[], severity: Finding['severity'] = 'warning') =>
    ({ ruleId, title: '', severity, message: '', targetIds, relatedIds: [], fixes: [] }) as Finding;

  it('finds what a change introduced, regardless of target order', () => {
    const before = [f('AP-1', ['a', 'b'])];
    const after = [f('AP-1', ['b', 'a']), f('AP-2', ['c'], 'error')];
    expect(newFindings(before, after).map((x) => x.ruleId)).toEqual(['AP-2']);
    expect(countFindings(after)).toEqual({ error: 1, warning: 1, info: 0 });
  });

  it('summarizes the catalog, with pairs for a filter', () => {
    const all = catalogSummary(testCatalog);
    expect(all.concepts.length).toBe(testCatalog.concepts.size);
    expect(all).not.toHaveProperty('pairs');
    const filtered = catalogSummary(testCatalog, 't.app');
    expect(filtered.concepts.map((c) => c.id)).toEqual(['t.app']);
    expect(filtered.pairs).toContainEqual({ from: 't.app', to: 't.service', types: ['calls'] });
    const service = catalogSummary(testCatalog, 't.service').concepts[0]!;
    expect(service.properties).toMatchObject({ type: 'object' });
  });
});
