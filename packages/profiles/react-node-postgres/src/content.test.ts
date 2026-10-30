import { describe, expect, it } from 'vitest';
import {
  adaptSolution,
  applySolution,
  checkStep,
  allRules,
  contentCoverage,
  createCatalog,
  runRules,
  startLesson,
} from '@archguide/core';
import type { ModelOp, Project } from '@archguide/core';
import { DOCS, LESSONS, PROFILE_ID, profile } from '.';

const catalog = createCatalog([profile]);
const docIds = new Set(DOCS.map((d) => d.id));
const known = (id: string) =>
  docIds.has(id) || catalog.concepts.has(id) || catalog.relationTypes.has(id);
/** Lesson checks see the same findings as the Problems panel. */
const ctx = (project: Project) => ({ catalog, findings: runRules(project, catalog) });
const LANGUAGES = new Set([
  'ts',
  'tsx',
  'js',
  'sql',
  'prisma',
  'yaml',
  'json',
  'bash',
  'python',
  'csharp',
]);

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

describe('rule references', () => {
  const ruleIds = new Set(allRules(catalog).map((r) => r.id));
  it.each([...DOCS, ...LESSONS].map((c) => [c.id, c] as const))(
    '%s: every rule ID it mentions exists',
    (_id, content) => {
      const mentioned = JSON.stringify(content).match(/\b(?:AP|RNP)-\d{3}\b/g) ?? [];
      for (const id of mentioned) expect(ruleIds.has(id), id).toBe(true);
    },
  );
});

describe('coverage (Implementation.md §17.6)', () => {
  it('every concept and relation type has a learning text', () => {
    const c = contentCoverage(catalog, DOCS);
    expect(c.concepts.missing).toEqual([]);
    expect(c.relationTypes.missing).toEqual([]);
  });
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
        checkStep(project, step, ctx(project)).passed,
        `${step.id}: passes before the learner acts`,
      ).toBe(false);
      project = applySolution(project, step, catalog);
      const after = checkStep(project, step, ctx(project));
      expect(after.failures, `${step.id}: solution does not satisfy the check`).toEqual([]);
    }
  });

  /**
   * Learners name shapes their own way. Every other step is done "by the learner" with
   * different IDs; "Show me" must still solve the steps in between (adaptSolution).
   */
  it.each(LESSONS.map((l) => [l.id, l] as const))(
    '%s: "Show me" works on a learner\'s own model',
    (_id, lesson) => {
      const mine = new Map<string, string>();
      const own = (id: string) => mine.get(id) ?? id;
      const byLearner = (ops: ModelOp[]): ModelOp[] =>
        ops.map((op) => {
          if (op.op === 'addElement') {
            mine.set(op.element.id, `${op.element.id}-mine`);
            const parentId = op.element.parentId && own(op.element.parentId);
            return {
              ...op,
              element: { ...op.element, id: own(op.element.id), ...(parentId ? { parentId } : {}) },
            };
          }
          if (op.op === 'addRelation') {
            mine.set(op.relation.id, `${op.relation.id}-mine`);
            const r = op.relation;
            return {
              ...op,
              relation: {
                ...r,
                id: own(r.id),
                sourceId: own(r.sourceId),
                targetId: own(r.targetId),
              },
            };
          }
          if (
            op.op === 'updateElement' ||
            op.op === 'updateRelation' ||
            op.op === 'removeElement' ||
            op.op === 'removeRelation'
          )
            return { ...op, id: own(op.id) };
          if (op.op === 'moveElement')
            return { ...op, id: own(op.id), parentId: op.parentId && own(op.parentId) };
          return op;
        });
      let project = startLesson(lesson, catalog, '2026-10-27T00:00:00.000Z');
      lesson.steps
        .filter((s) => s.check)
        .forEach((step, i) => {
          const ops =
            i % 2 === 0 ? byLearner(step.solution!) : adaptSolution(project, lesson, step);
          project = applySolution(project, { ...step, solution: ops }, catalog);
          expect(checkStep(project, step, ctx(project)).failures, step.id).toEqual([]);
        });
    },
  );
});
