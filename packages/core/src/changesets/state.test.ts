import { describe, expect, it } from 'vitest';
import type { ModelOp } from '../schema';
import { appendOps, storedChangeSet } from './state';
import { createChangeSet } from './state';
import { sampleProject } from '../test-support/fixtures';

const place = (elementId: string, x: number): ModelOp => ({
  op: 'setViewNode',
  viewId: 'main',
  node: { elementId, x, y: 0 },
});

describe('appendOps', () => {
  it('keeps the last placement of a shape in a run of view ops', () => {
    const ops = appendOps(
      [{ op: 'updateElement', id: 'a', patch: { tech: 'x' } }, place('a', 1), place('b', 1)],
      [place('a', 2), place('a', 3)],
    );
    expect(ops).toEqual([
      { op: 'updateElement', id: 'a', patch: { tech: 'x' } },
      place('b', 1),
      place('a', 3),
    ]);
  });

  it('merges typing into one update, and nothing else', () => {
    const name = (n: string): ModelOp => ({ op: 'updateElement', id: 'a', patch: { name: n } });
    expect(appendOps([name('O')], [name('Or'), name('Ord')])).toEqual([name('Ord')]);
    const props: ModelOp = { op: 'updateElement', id: 'a', patch: { properties: { x: 1 } } };
    expect(appendOps([props], [props])).toHaveLength(2);
    // A model op ends the run: placements before it stay.
    expect(appendOps([place('a', 1), name('A')], [place('a', 2)])).toHaveLength(3);
  });
});

describe('storedChangeSet', () => {
  it('moves an up-to-date change set to the revision its own save makes', () => {
    const p = sampleProject();
    const cs = createChangeSet(p, { name: 'X', now: '2026-10-28T00:00:00.000Z' });
    expect(storedChangeSet(cs, p).baseRevision).toBe(p.revision + 1);
    const old = { ...cs, baseRevision: p.revision - 1 };
    expect(storedChangeSet(old, p)).toBe(old);
  });
});
