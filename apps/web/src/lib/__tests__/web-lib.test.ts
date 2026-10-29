import { describe, expect, it } from 'vitest';
import { applyOps, createProject } from '@archguide/core';
import type { Op, Project } from '@archguide/core';
import { catalog } from '../catalog';
import { copySelection, pasteOps } from '../clipboard';
import { fieldsFor, labelFor } from '../fields';
import { toFlowEdges, toFlowNodes } from '../flow';
import { textAt, docFor, relatedDocs } from '../learn';
import {
  absolutePosition,
  deleteOps,
  freeSpot,
  minContainerSize,
  newElementOps,
  newRelationOps,
  nodeSize,
  reparentOps,
  resizeOps,
} from '../model';
import { sampleProject } from '../sample';
import { ICONS } from '../../canvas/icons';

function apply(p: Project, ops: Op[]): Project {
  const r = applyOps(p, ops, catalog);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.project;
}

const empty = () =>
  createProject({
    id: 't',
    name: 'T',
    profile: 'react-node-postgres',
    now: '2026-10-27T00:00:00.000Z',
  });
const view = (p: Project) => p.views[0]!;

describe('sample project', () => {
  it('is valid and shows every element and relation', () => {
    const p = sampleProject('starter', '2026-10-27T00:00:00.000Z');
    expect(view(p).nodes).toHaveLength(p.model.elements.length);
    expect(view(p).edges).toHaveLength(p.model.relations.length);
  });
});

describe('newElementOps', () => {
  it('adds a top-level element with its default layer at a free spot', () => {
    const p = empty();
    const r = newElementOps(p, view(p), 'node.service', { x: 100, y: 100 });
    expect(r.error).toBeUndefined();
    const next = apply(p, r.ops);
    expect(next.model.elements[0]).toMatchObject({
      id: 'svc.node-service',
      layer: 'application',
      status: 'planned',
    });
  });

  it('refuses a concept that cannot stand alone and explains where it goes', () => {
    const p = empty();
    const r = newElementOps(p, view(p), 'pg.schema', { x: 0, y: 0 });
    expect(r.ops).toEqual([]);
    expect(r.error).toMatch(/inside a database/);
  });

  it('nests into the container under the drop point, with a position relative to it', () => {
    let p = empty();
    p = apply(p, newElementOps(p, view(p), 'pg.database', { x: 200, y: 200 }).ops);
    const db = absolutePosition(p, view(p), 'db.database');
    const r = newElementOps(p, view(p), 'pg.schema', { x: db.x + 50, y: db.y + 50 });
    p = apply(p, r.ops);
    expect(p.model.elements.find((e) => e.id === r.id)?.parentId).toBe('db.database');
    const node = view(p).nodes.find((n) => n.elementId === r.id)!;
    expect(node.x).toBeGreaterThanOrEqual(16);
    expect(node.y).toBeGreaterThanOrEqual(32);
    // The database grows to enclose the schema.
    expect(nodeSize(p, view(p), 'db.database').w).toBeGreaterThanOrEqual(node.x + 110);
  });
});

describe('freeSpot', () => {
  it('places to the right of an occupied spot first', () => {
    let p = empty();
    p = apply(p, newElementOps(p, view(p), 'node.service', { x: 80, y: 40 }).ops);
    const first = absolutePosition(p, view(p), 'svc.node-service');
    const spot = freeSpot(p, view(p), first, { w: 160, h: 80 });
    expect(spot.y).toBe(first.y);
    expect(spot.x).toBeGreaterThan(first.x + 160);
  });
});

describe('reparentOps and deleteOps', () => {
  it('moves a module from one service into another, keeping where it is on screen', () => {
    let p = empty();
    p = apply(p, newElementOps(p, view(p), 'node.service', { x: 100, y: 100 }, { name: 'A' }).ops);
    p = apply(p, newElementOps(p, view(p), 'node.service', { x: 600, y: 100 }, { name: 'B' }).ops);
    p = apply(
      p,
      newElementOps(p, view(p), 'node.module', { x: 0, y: 0 }, { parentId: 'svc.a', name: 'M' })
        .ops,
    );
    const before = absolutePosition(p, view(p), 'mod.m');
    p = apply(p, reparentOps(p, view(p), 'mod.m', 'svc.b', { x: before.x + 520, y: before.y }));
    expect(p.model.elements.find((e) => e.id === 'mod.m')?.parentId).toBe('svc.b');
    expect(absolutePosition(p, view(p), 'mod.m')).toEqual({ x: before.x + 520, y: before.y });
  });

  it('moves a service out of a bounded context to the top level', () => {
    let p = empty();
    p = apply(
      p,
      newElementOps(p, view(p), 'group.context', { x: 200, y: 200 }, { name: 'Sales' }).ops,
    );
    p = apply(
      p,
      newElementOps(
        p,
        view(p),
        'node.service',
        { x: 0, y: 0 },
        { parentId: 'ctx.sales', name: 'Orders' },
      ).ops,
    );
    const before = absolutePosition(p, view(p), 'svc.orders');
    p = apply(p, reparentOps(p, view(p), 'svc.orders', null, before));
    expect(p.model.elements.find((e) => e.id === 'svc.orders')).not.toHaveProperty('parentId');
    expect(absolutePosition(p, view(p), 'svc.orders')).toEqual(before);
  });

  it('deletes children with their parent and keeps unrelated relations', () => {
    let p = sampleProject('s', '2026-10-27T00:00:00.000Z');
    p = apply(p, deleteOps(p, ['db.shop', 'schema.public'], ['rel.web-calls-api']));
    expect(p.model.elements.map((e) => e.id)).toEqual(['actor.customer', 'app.web', 'svc.api']);
    expect(p.model.relations.map((r) => r.id)).toEqual(['rel.customer-uses-web']);
  });
});

describe('resizeOps', () => {
  const withChild = () => {
    let p = empty();
    p = apply(
      p,
      newElementOps(p, view(p), 'group.context', { x: 200, y: 200 }, { name: 'Sales' }).ops,
    );
    return apply(
      p,
      newElementOps(
        p,
        view(p),
        'node.service',
        { x: 0, y: 0 },
        { parentId: 'ctx.sales', name: 'Orders' },
      ).ops,
    );
  };

  it('stores a larger size, and the container keeps it', () => {
    let p = withChild();
    const node = view(p).nodes.find((n) => n.elementId === 'ctx.sales')!;
    const size = nodeSize(p, view(p), 'ctx.sales');
    p = apply(
      p,
      resizeOps(p, view(p), 'ctx.sales', { x: node.x, y: node.y, w: size.w + 200, h: size.h + 96 }),
    );
    expect(nodeSize(p, view(p), 'ctx.sales')).toEqual({ w: size.w + 200, h: size.h + 96 });
  });

  it('never gets smaller than its children need', () => {
    let p = withChild();
    const node = view(p).nodes.find((n) => n.elementId === 'ctx.sales')!;
    const min = minContainerSize(p, view(p), 'ctx.sales');
    p = apply(p, resizeOps(p, view(p), 'ctx.sales', { x: node.x, y: node.y, w: 40, h: 40 }));
    expect(nodeSize(p, view(p), 'ctx.sales')).toEqual(min);
  });

  it('dragging the left or top edge keeps the children in place on the canvas', () => {
    let p = withChild();
    const node = view(p).nodes.find((n) => n.elementId === 'ctx.sales')!;
    const size = nodeSize(p, view(p), 'ctx.sales');
    const child = absolutePosition(p, view(p), 'svc.orders');
    p = apply(
      p,
      resizeOps(p, view(p), 'ctx.sales', {
        x: node.x - 80,
        y: node.y - 64,
        w: size.w + 80,
        h: size.h + 64,
      }),
    );
    expect(absolutePosition(p, view(p), 'svc.orders')).toEqual(child);
    expect(absolutePosition(p, view(p), 'ctx.sales')).toEqual({ x: node.x - 80, y: node.y - 64 });
  });

  it('stops the left edge at the children', () => {
    let p = withChild();
    const node = view(p).nodes.find((n) => n.elementId === 'ctx.sales')!;
    const size = nodeSize(p, view(p), 'ctx.sales');
    const child = absolutePosition(p, view(p), 'svc.orders');
    p = apply(
      p,
      resizeOps(p, view(p), 'ctx.sales', {
        x: node.x + 400,
        y: node.y,
        w: size.w - 400,
        h: size.h,
      }),
    );
    expect(absolutePosition(p, view(p), 'svc.orders')).toEqual(child);
    expect(view(p).nodes.find((n) => n.elementId === 'svc.orders')!.x).toBeGreaterThanOrEqual(16);
  });
});

describe('clipboard', () => {
  it('copies a container with its children and internal relations, and pastes with new IDs', () => {
    const p = sampleProject('s', '2026-10-27T00:00:00.000Z');
    const data = copySelection(p, view(p), ['db.shop', 'svc.api'])!;
    expect(data.elements.map((e) => e.id).sort()).toEqual(['db.shop', 'schema.public', 'svc.api']);
    expect(data.relations.map((r) => r.type).sort()).toEqual(['migrates', 'reads', 'writes']);
    const { ops, ids } = pasteOps(p, view(p), data);
    const next = apply(p, ops);
    expect(ids).toHaveLength(3);
    expect(next.model.elements).toHaveLength(p.model.elements.length + 3);
    const pastedSchema = next.model.elements.find(
      (e) => e.kind === 'pg.schema' && e.id !== 'schema.public',
    )!;
    expect(ids).toContain(pastedSchema.parentId);
  });
});

describe('flow mapping', () => {
  it('orders parents before children and makes child positions relative', () => {
    const p = sampleProject('s', '2026-10-27T00:00:00.000Z');
    const nodes = toFlowNodes(p, view(p));
    const db = nodes.findIndex((n) => n.id === 'db.shop');
    const schema = nodes.findIndex((n) => n.id === 'schema.public');
    expect(db).toBeLessThan(schema);
    expect(nodes[schema]).toMatchObject({ parentId: 'db.shop', position: { x: 16, y: 40 } });
    expect(nodes[db]!.data.container).toBe(true);
    expect(nodes[db]!.className).toContain('ag-container');
  });

  it('marks valid and invalid targets while connecting', () => {
    const p = sampleProject('s', '2026-10-27T00:00:00.000Z');
    const nodes = toFlowNodes(p, view(p), {
      connecting: { sourceId: 'app.web', validTargets: new Set(['svc.api']) },
    });
    expect(nodes.find((n) => n.id === 'svc.api')!.className).toBe('ag-target-valid');
    expect(nodes.find((n) => n.id === 'schema.public')!.className).toBe('ag-target-invalid');
    expect(nodes.find((n) => n.id === 'app.web')!.className).toBeUndefined();
  });

  it('spreads parallel relations between the same two elements', () => {
    const p = sampleProject('s', '2026-10-27T00:00:00.000Z');
    const edges = toFlowEdges(p, view(p)).filter(
      (e) => e.source === 'svc.api' && e.target === 'schema.public',
    );
    expect(edges.map((e) => e.data!.parallelIndex)).toEqual([0, 1, 2]);
    expect(edges.every((e) => e.data!.parallelCount === 3)).toBe(true);
  });

  it('builds relation ops that show the relation in the view', () => {
    const p = sampleProject('s', '2026-10-27T00:00:00.000Z');
    const { ops, id } = newRelationOps(p, view(p), 'calls', 'actor.customer', 'svc.api');
    const next = apply(p, ops);
    expect(view(next).edges.some((e) => e.relationId === id)).toBe(true);
  });
});

describe('property form fields', () => {
  it('derives inputs from a concept property schema', () => {
    const fields = fieldsFor(catalog.concepts.get('node.service')!.propertySchema);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.framework).toMatchObject({
      kind: 'enum',
      options: ['express', 'fastify', 'nestjs'],
    });
    expect(byKey.transport).toMatchObject({ kind: 'enum-list' });
    expect(byKey.instances).toMatchObject({ kind: 'number', integer: true, min: 1 });
    expect(byKey.runtime).toMatchObject({ kind: 'string' });
  });

  it('derives inputs from a relation type property schema', () => {
    const fields = fieldsFor(catalog.relationTypes.get('writes')!.propertySchema);
    expect(fields.map((f) => f.kind)).toEqual(['enum', 'enum', 'boolean', 'boolean']);
  });

  it.each([
    ['poolSize', 'Pool size'],
    ['rls', 'RLS'],
    ['staleTimeMs', 'Stale time (ms)'],
    ['idempotencyKey', 'Idempotency key'],
  ])('labels %s as %s', (key, label) => expect(labelFor(key)).toBe(label));
});

describe('learning text levels', () => {
  const doc = docFor('topic.concurrency-control')!;
  it('beginners get plain text, an analogy, one example and no references', () => {
    const v = textAt(doc, 'beginner');
    expect(v.text).toBe(doc.explain.beginner);
    expect(v.analogy).toBeDefined();
    expect(v.examples).toHaveLength(1);
    expect(v.references).toEqual([]);
  });
  it('seniors get the deep text, trade-offs and references', () => {
    const v = textAt(doc, 'senior');
    expect(v.text).toBe(doc.explain.senior);
    expect(v.lists.map((l) => l.title)).toContain('Trade-offs');
    expect(v.references.length).toBeGreaterThan(0);
  });
  it('finds related texts for a concept without its own text', () => {
    expect(relatedDocs('node.worker').map((d) => d.id)).toContain(
      'topic.event-loop-and-parallelism',
    );
  });
});

describe('icons', () => {
  it('has an icon for every concept in the catalog', () => {
    for (const c of catalog.concepts.values())
      expect(ICONS[c.icon], `${c.id}: ${c.icon}`).toBeDefined();
  });
});
