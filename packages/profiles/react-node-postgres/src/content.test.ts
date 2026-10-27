import { describe, expect, it } from 'vitest';
import { applySolution, checkStep, createCatalog, startLesson } from '@archguide/core';
import { DOCS, LESSONS, PROFILE_ID, profile } from '.';

const catalog = createCatalog([profile]);
const docIds = new Set(DOCS.map((d) => d.id));
const known = (id: string) =>
  docIds.has(id) || catalog.concepts.has(id) || catalog.relationTypes.has(id);
const LANGUAGES = new Set(['ts', 'tsx', 'js', 'sql', 'prisma', 'yaml', 'json', 'bash']);

describe('learning texts', () => {
  it('has content', () => {
    expect(DOCS.length).toBeGreaterThan(0);
    expect(LESSONS.length).toBeGreaterThan(0);
  });

  it('IDs are unique', () => {
    expect(docIds.size).toBe(DOCS.length);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
  });

  it.each(DOCS.map((d) => [d.id, d] as const))('%s: id matches its kind', (id, doc) => {
    switch (doc.kind) {
      case 'concept':
        return expect(catalog.concepts.has(id)).toBe(true);
      case 'relation':
        return expect(catalog.relationTypes.has(id)).toBe(true);
      case 'rule':
        return expect(id).toMatch(/^(AP|RNP)-\d{3}$/);
      case 'topic':
        return expect(id).toMatch(/^topic\./);
      case 'pattern':
        return expect(id).toMatch(/^pattern\./);
    }
  });

  it.each(DOCS.map((d) => [d.id, d] as const))(
    '%s: links, references and examples are valid',
    (_id, doc) => {
      for (const related of doc.related) expect(known(related), `related "${related}"`).toBe(true);
      expect(doc.references.length, 'every text cites at least one source').toBeGreaterThan(0);
      for (const example of doc.examples ?? [])
        expect(LANGUAGES.has(example.language), example.language).toBe(true);
      expect(doc.related).not.toContain(doc.id);
    },
  );
});

describe('lessons', () => {
  it.each(LESSONS.map((l) => [l.id, l] as const))(
    '%s: belongs to this profile and links known texts',
    (_id, lesson) => {
      expect(lesson.profile).toBe(PROFILE_ID);
      for (const id of lesson.conceptIds) expect(known(id), id).toBe(true);
      expect(new Set(lesson.steps.map((s) => s.id)).size).toBe(lesson.steps.length);
    },
  );

  /**
   * Proves every lesson can be finished: from the start model, each step with a check
   * fails before its solution and passes after it. Reading steps have no solution.
   */
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: is solvable step by step', (_id, lesson) => {
    let project = startLesson(lesson, catalog, '2026-10-27T00:00:00.000Z');
    for (const step of lesson.steps) {
      if (!step.check) {
        expect(step.solution, `${step.id}: reading steps have no solution`).toBeUndefined();
        continue;
      }
      expect(step.solution, `${step.id}: a step with a check needs a solution`).toBeDefined();
      expect(
        checkStep(project, step, { catalog }).passed,
        `${step.id}: passes before the learner acts`,
      ).toBe(false);
      project = applySolution(project, step, catalog);
      const after = checkStep(project, step, { catalog });
      expect(after.failures, `${step.id}: solution does not satisfy the check`).toEqual([]);
    }
  });
});
