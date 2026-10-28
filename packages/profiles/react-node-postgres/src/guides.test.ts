import { describe, expect, it } from 'vitest';
import { checkGuides, createCatalog } from '@archguide/core';
import { profile } from '.';

describe('concept guides (Implementation.md §13.11)', () => {
  const catalog = createCatalog([profile]);

  it('every typical connection is allowed by the relation rules', () => {
    expect(checkGuides(catalog)).toEqual([]);
  });

  it('every concept has real-world examples', () => {
    for (const c of catalog.concepts.values()) {
      const guide = catalog.guides.get(c.id);
      expect(guide, c.id).toBeDefined();
      expect(guide!.examples.length, c.id).toBeGreaterThan(0);
    }
  });

  it('every concept that can connect to something lists typical connections', () => {
    for (const c of catalog.concepts.values()) {
      if (c.category === 'group' || c.category === 'cross-cutting') continue;
      expect(catalog.guides.get(c.id)!.connections.length, c.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('notes are one short sentence and no connection is listed twice', () => {
    for (const [id, guide] of catalog.guides) {
      const keys = guide.connections.map((l) => `${l.direction}|${l.type}|${l.kind}`);
      expect(new Set(keys).size, id).toBe(keys.length);
      for (const l of guide.connections) {
        expect(l.note, `${id} ${l.kind}`).toMatch(/^[A-Z`].*[.)]$/);
        expect(l.note.length, `${id} ${l.kind}`).toBeLessThanOrEqual(110);
      }
    }
  });

  it('the Redux example: store, action, effect and API client connect as people expect', () => {
    const store = catalog.guides.get('react.client-store')!.connections;
    expect(store).toContainEqual(
      expect.objectContaining({ direction: 'in', type: 'updates', kind: 'react.action' }),
    );
    const action = catalog.guides.get('react.action')!.connections;
    expect(action).toContainEqual(
      expect.objectContaining({ type: 'fetches-via', kind: 'react.api-client' }),
    );
    expect(action).toContainEqual(
      expect.objectContaining({ direction: 'in', type: 'dispatches', kind: 'react.effect' }),
    );
  });
});
