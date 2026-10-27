import { describe, expect, it } from 'vitest';
import { applyOps } from '../ops';
import { sampleProject, testCatalog } from '../test-support/fixtures';
import type { ModelOp, Project } from '../schema';
import { diffProjects, isEmptyDiff } from '.';

function change(p: Project, ops: ModelOp[]): Project {
  const result = applyOps(p, ops, testCatalog);
  if (!result.ok) throw new Error(JSON.stringify(result.errors[0]));
  return result.project;
}

describe('diffProjects', () => {
  it('finds nothing between equal models, whatever the key order', () => {
    const p = sampleProject();
    const reordered: Project = {
      ...p,
      model: {
        ...p.model,
        elements: p.model.elements.map(
          (e) => Object.fromEntries(Object.entries(e).reverse()) as typeof e,
        ),
      },
    };
    expect(isEmptyDiff(diffProjects(p, reordered))).toBe(true);
  });

  it('reports added, removed and changed elements and relations', () => {
    const before = sampleProject();
    const [first, second] = before.model.elements;
    const relation = before.model.relations[0]!;
    const after = change(before, [
      {
        op: 'addElement',
        element: { id: 'svc.new', kind: 't.service', name: 'New', status: 'planned' },
      },
      { op: 'updateElement', id: first!.id, patch: { name: 'Renamed', tags: ['x'] } },
      { op: 'removeRelation', id: relation.id },
    ]);
    const d = diffProjects(before, after);
    expect(d.added).toEqual({ elements: ['svc.new'], relations: [] });
    expect(d.removed).toEqual({ elements: [], relations: [relation.id] });
    expect(d.changed).toEqual([{ id: first!.id, kind: 'element', fields: ['name', 'tags'] }]);
    expect(d.changed.some((c) => c.id === second!.id)).toBe(false);
    // The other direction swaps added and removed.
    const back = diffProjects(after, before);
    expect(back.added.relations).toEqual([relation.id]);
    expect(back.removed.elements).toEqual(['svc.new']);
  });

  it('ignores layout: moving a shape is not a model change', () => {
    const before = sampleProject();
    const node = before.views[0]!.nodes[0];
    if (!node) return;
    const after = change(before, [
      { op: 'setViewNode', viewId: before.views[0]!.id, node: { ...node, x: node.x + 100 } },
    ]);
    expect(isEmptyDiff(diffProjects(before, after))).toBe(true);
  });
});
