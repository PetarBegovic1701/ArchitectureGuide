import { describe, expect, it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { applyOps } from '@archguide/core';
import type { Op, Project, View } from '@archguide/core';
import { catalog } from '../catalog';
import { BUILTIN_TEMPLATES, projectFromTemplate } from '../templates';
import { sampleProject } from '../sample';
import { layoutOps, toElkGraph } from '../layout';
import { alignOps, alignProblem, distributeOps } from '../align';
import { absolutePosition, nodeSize } from '../model';

const NOW = '2026-10-27T00:00:00.000Z';

function apply(p: Project, ops: Op[]): Project {
  const result = applyOps(p, ops, catalog);
  if (!result.ok) throw new Error(JSON.stringify(result.errors[0]));
  return result.project;
}

/** Absolute boxes of the top-level shapes. */
function topBoxes(p: Project, view: View) {
  return view.nodes
    .filter((n) => !p.model.elements.find((e) => e.id === n.elementId)?.parentId)
    .map((n) => ({
      id: n.elementId,
      ...absolutePosition(p, view, n.elementId),
      ...nodeSize(p, view, n.elementId),
    }));
}

const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('auto-layout', () => {
  it.each(BUILTIN_TEMPLATES.map((t) => [t.code, t] as const))(
    '%s: lays out every shape without overlaps, children inside their containers',
    async (_code, template) => {
      const p = projectFromTemplate(template, {}, { id: 'p', name: 'P', now: NOW });
      const view = p.views[0]!;
      const laid = await new ELK().layout(toElkGraph(p, view));
      const ops = layoutOps(view, laid);
      expect(ops).toHaveLength(view.nodes.length);
      const after = apply(p, ops);
      const v = after.views[0]!;
      const boxes = topBoxes(after, v);
      for (const a of boxes)
        for (const b of boxes) if (a !== b) expect(overlap(a, b), `${a.id} / ${b.id}`).toBe(false);
      for (const n of v.nodes) {
        const parent = after.model.elements.find((e) => e.id === n.elementId)?.parentId;
        if (!parent) continue;
        expect(n.x, n.elementId).toBeGreaterThanOrEqual(8);
        expect(n.y, n.elementId).toBeGreaterThanOrEqual(32);
      }
      // Layout does not change the model.
      expect(after.model).toEqual(p.model);
    },
  );
});

describe('align and distribute', () => {
  const p = sampleProject('p', NOW);
  const view = p.views[0]!;
  const top = ['actor.customer', 'app.web', 'svc.api'];

  it('aligns shapes on one edge', () => {
    const after = apply(p, alignOps(p, view, top, 'top'));
    const ys = top.map((id) => after.views[0]!.nodes.find((n) => n.elementId === id)!.y);
    expect(new Set(ys).size).toBe(1);
    const middle = apply(p, alignOps(p, view, top, 'middle'));
    const centers = top.map((id) => {
      const v = middle.views[0]!;
      const n = v.nodes.find((x) => x.elementId === id)!;
      return n.y + nodeSize(middle, v, id).h / 2;
    });
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(8); // grid snap
  });

  it('distributes shapes with equal gaps', () => {
    const after = apply(p, distributeOps(p, view, top, 'horizontal'));
    const v = after.views[0]!;
    const boxes = top
      .map((id) => ({ x: v.nodes.find((n) => n.elementId === id)!.x, w: nodeSize(after, v, id).w }))
      .sort((a, b) => a.x - b.x);
    const gaps = boxes.slice(1).map((b, i) => b.x - (boxes[i]!.x + boxes[i]!.w));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(8);
  });

  it('refuses selections from different containers', () => {
    expect(alignProblem(p, view, ['svc.api'])).toMatch(/at least 2/);
    expect(alignProblem(p, view, ['svc.api', 'schema.public'])).toMatch(/same container/);
    expect(alignOps(p, view, ['svc.api', 'schema.public'], 'left')).toEqual([]);
    expect(alignProblem(p, view, top)).toBeUndefined();
  });
});
