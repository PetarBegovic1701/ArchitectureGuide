import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CORE_CONCEPTS,
  SHAPES,
  CatalogError,
  checkGuides,
  checkNesting,
  checkRelation,
  conceptConnections,
  createCatalog,
  isDenyRule,
  matchSelector,
  shapeOf,
  validRelationTypes,
} from '.';
import { KindSchema } from '../schema';
import { testCatalog, testProfile } from '../test-support/fixtures';

describe('core catalog integrity', () => {
  const catalog = createCatalog();

  it('every concept has a known category, a shape, an icon, a prefix and docs', () => {
    for (const c of catalog.concepts.values()) {
      expect(CATEGORIES[c.category], c.id).toBeDefined();
      expect(SHAPES[shapeOf(c)], c.id).toBeDefined();
      expect(c.icon, c.id).not.toBe('');
      expect(c.idPrefix, c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.docs.length, c.id).toBeGreaterThan(5);
      expect(KindSchema.safeParse(c.id).success, c.id).toBe(true);
      expect(c.allowedParents.length, c.id).toBeGreaterThan(0);
    }
  });

  it('every relation type has at least one allow rule', () => {
    const allowed = new Set(
      catalog.allowRules.flatMap((r) => (Array.isArray(r.type) ? r.type : [r.type])),
    );
    for (const t of catalog.relationTypes.keys()) expect(allowed.has(t), t).toBe(true);
  });

  it('every rule names a known relation type or "*"', () => {
    const known = new Set([...catalog.relationTypes.keys(), '*']);
    for (const r of [...catalog.allowRules, ...catalog.denyRules]) {
      for (const t of Array.isArray(r.type) ? r.type : [r.type]) expect(known.has(t), t).toBe(true);
    }
  });

  it('rejects duplicate concepts and prefixes', () => {
    const dup = { ...testProfile, concepts: [CORE_CONCEPTS[0]!] };
    expect(() => createCatalog([dup])).toThrow(CatalogError);
    const prefix = {
      ...testProfile,
      concepts: [{ ...testProfile.concepts[0]!, id: 't.other', idPrefix: 'actor' }],
    };
    expect(() => createCatalog([prefix])).toThrow(/prefix "actor"/);
  });

  it('puts profile deny rules before core deny rules', () => {
    const profile = {
      ...testProfile,
      relationRules: [{ type: 'calls', deny: { from: ['t.db'] }, message: 'profile message' }],
    };
    const c = createCatalog([profile]);
    expect(c.denyRules[0]!.message).toBe('profile message');
    expect(c.denyRules.every(isDenyRule)).toBe(true);
  });
});

describe('matchSelector', () => {
  const service = testCatalog.concepts.get('t.service')!;
  it.each([
    ['*', true],
    ['t.service', true],
    ['t.*', true],
    ['gen.*', false],
    ['category:deployable', true],
    ['category:module', false],
    ['group:Backend', true],
    ['group:Frontend', false],
    ['top', false],
  ])('%s → %s', (selector, expected) => expect(matchSelector(selector, service)).toBe(expected));
});

describe('validRelationTypes', () => {
  it('orders types by priority', () => {
    expect(validRelationTypes(testCatalog, 't.service', 't.db').map((t) => t.id)).toEqual([
      'reads',
      'writes',
    ]);
  });

  it('returns calls for app → service', () => {
    expect(validRelationTypes(testCatalog, 't.app', 't.service').map((t) => t.id)).toEqual([
      'calls',
    ]);
  });

  it('returns nothing for unknown kinds', () => {
    expect(validRelationTypes(testCatalog, 'x.nope', 't.db')).toEqual([]);
  });

  it('never allows relations to or from groups', () => {
    expect(validRelationTypes(testCatalog, 't.service', 'group.layer')).toEqual([]);
    expect(validRelationTypes(testCatalog, 'group.context', 't.service')).toEqual([]);
  });
});

describe('checkRelation (generic hard constraints)', () => {
  it('a data store does not call anything, and the fix is to flip and read', () => {
    const check = checkRelation(testCatalog, 'calls', 't.db', 't.service');
    expect(check).toMatchObject({ ok: false, code: 'RELATION_NOT_ALLOWED', flip: 'reads' });
    if (!check.ok) expect(check.message).toMatch(/data store does not call/);
  });

  it('a queue does not call its consumer; the fix is to flip and consume', () => {
    expect(checkRelation(testCatalog, 'calls', 't.queue', 't.service')).toMatchObject({
      ok: false,
      flip: 'consumes',
    });
  });

  it('a port does not implement an adapter; the fix keeps the type and flips', () => {
    const check = checkRelation(testCatalog, 'implements', 't.port', 't.adapter');
    expect(check).toMatchObject({ ok: false, flip: 'implements' });
    if (!check.ok) expect(check.message).toMatch(/Reversed/);
  });

  it('domain objects have no I/O', () => {
    const catalog = createCatalog([
      {
        ...testProfile,
        concepts: [
          ...testProfile.concepts,
          {
            id: 't.entity',
            name: 'Entity',
            category: 'domain-object',
            icon: 'hexagon',
            idPrefix: 'ent',
            allowedParents: ['top'],
            palette: { group: 'Backend', order: 9, basic: false },
            docs: 'An entity.',
          },
        ],
      },
    ]);
    const check = checkRelation(catalog, 'reads', 't.entity', 't.db');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.message).toMatch(/no I\/O/);
  });

  it('lists valid alternatives in the message', () => {
    const check = checkRelation(testCatalog, 'calls', 't.service', 't.db');
    expect(check).toMatchObject({ ok: false, alternatives: ['reads', 'writes'] });
    if (!check.ok) expect(check.message).toMatch(/Valid here: reads, writes/);
  });

  it('refuses self relations by default', () => {
    expect(
      checkRelation(testCatalog, 'calls', 't.service', 't.service', { self: true }),
    ).toMatchObject({
      ok: false,
      code: 'SELF_RELATION',
    });
  });

  it('reports unknown types and kinds', () => {
    expect(checkRelation(testCatalog, 'teleports', 't.app', 't.db')).toMatchObject({
      code: 'UNKNOWN_RELATION',
    });
    expect(checkRelation(testCatalog, 'calls', 't.app', 'x.y')).toMatchObject({
      code: 'UNKNOWN_KIND',
    });
  });
});

describe('checkNesting', () => {
  it('allows top level only when "top" is listed', () => {
    expect(checkNesting(testCatalog, 't.service', null).ok).toBe(true);
    const module = checkNesting(testCatalog, 't.module', null);
    expect(module.ok).toBe(false);
    if (!module.ok) expect(module.message).toMatch(/must be placed inside Service or Module/);
  });

  it('checks the parent against the selectors', () => {
    expect(checkNesting(testCatalog, 't.module', 't.service').ok).toBe(true);
    expect(checkNesting(testCatalog, 't.service', 'group.context').ok).toBe(true);
    expect(checkNesting(testCatalog, 't.service', 't.db')).toMatchObject({
      ok: false,
      code: 'NESTING_NOT_ALLOWED',
    });
  });
});

describe('concept guides', () => {
  const guided = (guides: Record<string, unknown>) =>
    createCatalog([{ ...testProfile, guides: guides as never }]);

  it('accepts connections the relation rules allow', () => {
    const catalog = guided({
      't.app': {
        examples: ['A shop front end.'],
        connections: [{ direction: 'out', type: 'calls', kind: 't.service', note: 'Loads data.' }],
      },
    });
    expect(checkGuides(catalog)).toEqual([]);
  });

  it('reports unknown concepts, unknown types and refused connections', () => {
    const catalog = guided({
      't.nope': { examples: [], connections: [] },
      't.app': {
        examples: [],
        connections: [
          { direction: 'out', type: 'calls', kind: 't.missing', note: '' },
          { direction: 'out', type: 'teleports', kind: 't.service', note: '' },
          { direction: 'in', type: 'implements', kind: 't.service', note: '' },
        ],
      },
    });
    expect(checkGuides(catalog)).toEqual([
      'Guide for unknown concept "t.nope"',
      't.app → calls t.missing: unknown concept',
      't.app → teleports t.service: unknown relation type',
      't.app ← implements t.service: not allowed by the relation rules',
    ]);
  });

  it('refuses two guides for the same concept', () => {
    const guides = { 't.app': { examples: [], connections: [] } };
    expect(() =>
      createCatalog([
        { ...testProfile, guides },
        { ...testProfile, id: 'other', concepts: [], relationTypes: [], relationRules: [], guides },
      ]),
    ).toThrow(CatalogError);
  });

  it('lists typical connections first and every other allowed pair grouped by type', () => {
    const typical = { direction: 'out', type: 'calls', kind: 't.service', note: 'Loads data.' };
    const catalog = guided({ 't.app': { examples: [], connections: [typical] } });
    const { typical: first, other } = conceptConnections(catalog, 't.app');
    expect(first).toEqual([typical]);
    // The typical pair is not repeated in the other groups.
    const calls = other.find((g) => g.direction === 'out' && g.type.id === 'calls');
    expect(calls?.concepts.map((c) => c.id) ?? []).not.toContain('t.service');
    // Every listed pair is valid.
    for (const g of other)
      for (const c of g.concepts) {
        const [from, to] = g.direction === 'out' ? ['t.app', c.id] : [c.id, 't.app'];
        expect(validRelationTypes(catalog, from, to).map((t) => t.id)).toContain(g.type.id);
      }
    // Outgoing groups come before incoming ones.
    const firstIn = other.findIndex((g) => g.direction === 'in');
    if (firstIn >= 0) expect(other.slice(firstIn).every((g) => g.direction === 'in')).toBe(true);
  });
});
