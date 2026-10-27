import { describe, expect, it } from 'vitest';
import { GraphQuery } from '.';
import { build, testCatalog } from '../test-support/fixtures';

const graph = (p: ReturnType<typeof build>) => new GraphQuery(p, testCatalog);

describe('GraphQuery', () => {
  const p = build(
    [
      ['svc.a', 't.service'],
      ['mod.a1', 't.module', { parentId: 'svc.a' }],
      ['mod.a2', 't.module', { parentId: 'mod.a1' }],
      ['svc.b', 't.service', { layer: 'domain' }],
      ['db.main', 't.db'],
      ['q.jobs', 't.queue'],
    ],
    [
      ['mod.a2', 'calls', 'svc.b'],
      ['svc.b', 'calls', 'svc.a'],
      ['mod.a1', 'writes', 'db.main'],
      ['svc.a', 'publishes', 'q.jobs'],
    ],
  );
  const g = graph(p);

  it('indexes relations and nesting', () => {
    expect(g.outgoing('mod.a2').map((r) => r.targetId)).toEqual(['svc.b']);
    expect(g.incoming('svc.a', 'calls').map((r) => r.sourceId)).toEqual(['svc.b']);
    expect(g.children('svc.a').map((e) => e.id)).toEqual(['mod.a1']);
    expect(g.subtree('svc.a').map((e) => e.id)).toEqual(['svc.a', 'mod.a1', 'mod.a2']);
    expect(g.ancestors('mod.a2').map((e) => e.id)).toEqual(['mod.a1', 'svc.a']);
    expect(
      g
        .outgoingFromSubtree('svc.a')
        .map((r) => r.targetId)
        .sort(),
    ).toEqual(['db.main', 'q.jobs', 'svc.b']);
  });

  it('finds the deployable that runs an element, and layers with defaults', () => {
    expect(g.deployableOf('mod.a2')?.id).toBe('svc.a');
    expect(g.deployableOf('db.main')).toBeUndefined();
    expect(g.layerOf('svc.b')).toBe('domain');
    expect(g.layerOf('db.main')).toBe('data');
    expect(g.layerOf('mod.a1')).toBe('application');
  });

  it('finds cycles after lifting elements to their deployable', () => {
    expect(g.cycles(['calls'])).toEqual([]);
    expect(g.cycles(['calls'], (id) => g.deployableOf(id)?.id)).toEqual([['svc.a', 'svc.b']]);
    expect(
      g.cycles(
        ['calls'],
        (id) => g.deployableOf(id)?.id,
        () => false,
      ),
    ).toEqual([]);
  });

  it('matches specialized relation types', () => {
    expect(
      g.typeIs(
        p.model.relations.find((r) => r.type === 'publishes')!,
        'publishes',
      ),
    ).toBe(true);
  });

  it('computes the longest chain without looping forever', () => {
    expect(g.longestChain('svc.b', ['calls'], (id) => g.deployableOf(id)?.id)).toEqual([
      'svc.b',
      'svc.a',
    ]);
  });
});
