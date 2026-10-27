import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyOps } from '.';
import { serializeProject } from '../serialize';
import type { Op, Project } from '../schema';
import { el, rel, sampleProject, testCatalog } from '../test-support/fixtures';

/**
 * Random op sequences: whatever applies must be undone exactly by the inverse.
 * Ops are drawn against the current state, so most of them are valid.
 */
type Step = { kind: number; a: number; b: number; c: number };

const kinds = ['t.service', 't.db', 't.queue', 't.module', 't.adapter', 'group.context'];
const relationTypes = [
  'calls',
  'reads',
  'writes',
  'publishes',
  'consumes',
  'implements',
  'depends-on',
];

function pick<T>(list: readonly T[], n: number): T | undefined {
  return list.length === 0 ? undefined : list[n % list.length];
}

function opFor(p: Project, step: Step, counter: number): Op | undefined {
  const elements = p.model.elements;
  const relations = p.model.relations;
  const a = pick(elements, step.a);
  const b = pick(elements, step.b);
  switch (step.kind % 9) {
    case 0: {
      const kind = pick(kinds, step.c)!;
      return {
        op: 'addElement',
        element: el(`x.e${counter}`, kind, { ...(b ? { parentId: b.id } : {}) }),
      };
    }
    case 1:
      return { op: 'addElement', element: el(`x.top${counter}`, pick(kinds, step.c)!) };
    case 2:
      return a && b
        ? {
            op: 'addRelation',
            relation: rel(`rel.r${counter}`, pick(relationTypes, step.c)!, a.id, b.id),
          }
        : undefined;
    case 3:
      return a ? { op: 'removeElement', id: a.id, cascade: true } : undefined;
    case 4:
      return a
        ? { op: 'moveElement', id: a.id, parentId: step.c % 2 === 0 ? null : (b?.id ?? null) }
        : undefined;
    case 5:
      return a
        ? {
            op: 'updateElement',
            id: a.id,
            patch: { name: `n${counter}`, tags: step.c % 2 ? null : ['t'] },
          }
        : undefined;
    case 6:
      return a ? { op: 'renameId', from: a.id, to: `x.renamed${counter}` } : undefined;
    case 7: {
      const r = pick(relations, step.a);
      return r ? { op: 'removeRelation', id: r.id } : undefined;
    }
    case 8:
      return a
        ? { op: 'setViewNode', viewId: 'main', node: { elementId: a.id, x: step.b, y: step.c } }
        : undefined;
  }
}

describe('inverse ops (property)', () => {
  it('applying the collected inverses restores the original project', () => {
    const step = fc.record({ kind: fc.nat(), a: fc.nat(), b: fc.nat(), c: fc.nat() });
    let totalApplied = 0;
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 25 }), (steps) => {
        const original = sampleProject();
        let current = original;
        const undo: Op[][] = [];
        let applied = 0;
        steps.forEach((s, i) => {
          const op = opFor(current, s, i);
          if (!op) return;
          const result = applyOps(current, [op], testCatalog);
          if (!result.ok) return;
          current = result.project;
          undo.push(result.inverse);
          applied++;
        });
        for (const inverse of undo.reverse()) {
          const result = applyOps(current, inverse, testCatalog);
          if (!result.ok) throw new Error(`inverse failed: ${JSON.stringify(result.errors)}`);
          current = result.project;
        }
        expect(serializeProject(current)).toBe(serializeProject(original));
        totalApplied += applied;
      }),
      { numRuns: 300 },
    );
    // Guard against a generator that only produces refused ops.
    expect(totalApplied).toBeGreaterThan(1000);
  });

  it('a batch inverse equals undoing op by op', () => {
    const p = sampleProject();
    const ops: Op[] = [
      { op: 'addElement', element: el('svc.b', 't.service') },
      { op: 'addRelation', relation: rel('rel.b-db', 'reads', 'svc.b', 'db.main') },
      { op: 'renameId', from: 'svc.b', to: 'svc.billing' },
      { op: 'removeElement', id: 'svc.api', cascade: true },
    ];
    const batch = applyOps(p, ops, testCatalog);
    if (!batch.ok) throw new Error('batch failed');
    const back = applyOps(batch.project, batch.inverse, testCatalog);
    if (!back.ok) throw new Error(JSON.stringify(back.errors));
    expect(serializeProject(back.project)).toBe(serializeProject(p));
  });
});
