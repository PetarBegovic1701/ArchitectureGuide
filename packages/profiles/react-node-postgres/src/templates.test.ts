import { describe, expect, it } from 'vitest';
import {
  applyOps,
  createCatalog,
  createProject,
  instantiateTemplate,
  resolveParams,
  runRules,
} from '@archguide/core';
import type { Project, Template } from '@archguide/core';
import { DOCS, PROFILE_ID, TEMPLATES, profile } from '.';

const catalog = createCatalog([profile]);
const known = (id: string) =>
  DOCS.some((d) => d.id === id) || catalog.concepts.has(id) || catalog.relationTypes.has(id);

/** A project that only has the template's packs on (plus core and the profile). */
function fromTemplate(t: Template, params?: Record<string, unknown>): Project {
  const p = createProject({ id: 'p', name: 'P', profile: PROFILE_ID, rulePacks: ['core'] });
  const { ops } = instantiateTemplate(t, p, catalog, { params });
  const result = applyOps(p, ops, catalog);
  if (!result.ok) throw new Error(`${t.id}: ${JSON.stringify(result.errors[0])}`);
  return result.project;
}

/** Parameter sets to try: defaults, the smallest lists, and the largest lists. */
function variants(t: Template): Record<string, unknown>[] {
  const smallest: Record<string, unknown> = {};
  const largest: Record<string, unknown> = {};
  for (const p of t.parameters) {
    if (p.type !== 'string[]') continue;
    smallest[p.key] = [p.default[0]];
    largest[p.key] = Array.from({ length: p.max ?? 6 }, (_, i) => `${p.label} ${i + 1}`);
  }
  for (const p of t.parameters) if (p.type === 'enum') largest[p.key] = p.options.at(-1);
  return [{}, smallest, largest];
}

describe('templates', () => {
  it('have unique IDs and codes', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    expect(new Set(TEMPLATES.map((t) => t.code)).size).toBe(TEMPLATES.length);
    expect(TEMPLATES.map((t) => t.code)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T11']);
  });

  it.each(TEMPLATES.map((t) => [t.code, t] as const))(
    '%s: describes itself and links learning texts',
    (_code, t) => {
      expect(resolveParams(t).errors).toEqual({});
      expect(t.whenToUse.length).toBeGreaterThan(0);
      expect(t.whenNotToUse.length).toBeGreaterThan(0);
      expect(t.tradeoffs.length).toBeGreaterThan(0);
      expect(t.invariants.length).toBeGreaterThan(0);
      expect(t.learnId && DOCS.some((d) => d.id === t.learnId), `${t.learnId}`).toBe(true);
    },
  );

  it.each(TEMPLATES.map((t) => [t.code, t] as const))(
    '%s: builds with any parameters and has no errors or warnings under its packs',
    (_code, t) => {
      for (const params of variants(t)) {
        const p = fromTemplate(t, params);
        const problems = runRules(p, catalog)
          .filter((f) => f.severity !== 'info')
          .map((f) => `${f.ruleId} ${f.targetIds.join(',')}: ${f.message}`);
        expect(problems, JSON.stringify(params)).toEqual([]);
        for (const step of p.tours[0]?.steps ?? [])
          for (const id of step.conceptIds ?? []) expect(known(id), id).toBe(true);
      }
    },
  );

  it.each(TEMPLATES.map((t) => [t.code, t] as const))(
    '%s: has a tour and is quiet: no tips either',
    (_code, t) => {
      const p = fromTemplate(t);
      expect(p.tours).toHaveLength(1);
      expect(runRules(p, catalog).map((f) => `${f.ruleId}: ${f.message}`)).toEqual([]);
    },
  );

  it.each(TEMPLATES.map((t) => [t.code, t] as const))(
    '%s: can be stamped twice into one project',
    (_code, t) => {
      const once = fromTemplate(t);
      const { ops } = instantiateTemplate(t, once, catalog, { origin: { x: 0, y: 1200 } });
      const twice = applyOps(once, ops, catalog);
      expect(twice.ok).toBe(true);
    },
  );

  it.each(TEMPLATES.map((t) => [t.code, t] as const))(
    '%s: top-level shapes do not overlap',
    (_code, t) => {
      const p = fromTemplate(t, variants(t)[2]);
      const top = p.views[0]!.nodes.filter(
        (n) => !p.model.elements.find((e) => e.id === n.elementId)?.parentId,
      );
      // Same position means two shapes on top of each other.
      const spots = top.map((n) => `${n.x},${n.y}`);
      expect(new Set(spots).size).toBe(spots.length);
    },
  );
});
