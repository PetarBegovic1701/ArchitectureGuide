import { describe, expect, it } from 'vitest';
import {
  CheckSchema,
  ContentError,
  adaptSolution,
  applySolution,
  checkStep,
  evaluateCheck,
  parseLearningDoc,
  parseLesson,
  startLesson,
} from '.';
import type { Check } from '.';
import { sampleProject, testCatalog } from '../test-support/fixtures';

const DOC = `---
id: topic.example
kind: topic
title: Example topic
summary: A short summary.
level: beginner
tracks: [foundations]
related: [t.service]
references:
  - title: Spec
    url: https://example.com/spec
quiz:
  - question: Pick one
    options: [a, b]
    answer: 1
    explanation: Because b.
---

## Beginner

Plain words.

## Senior

Deep words.

## When to use

- First case
- Second case that
  continues here

## Examples

**Create a table:**

\`\`\`sql
CREATE TABLE t (id int);
\`\`\`

\`\`\`ts
const x = \`template \${1}\`;
\`\`\`
`;

describe('parseLearningDoc', () => {
  it('parses front matter and sections', () => {
    const doc = parseLearningDoc(DOC, 'example.md');
    expect(doc).toMatchObject({
      id: 'topic.example',
      explain: { beginner: 'Plain words.', senior: 'Deep words.' },
      whenToUse: ['First case', 'Second case that continues here'],
      quiz: [{ answer: 1 }],
      source: 'example.md',
    });
    expect(doc.examples).toEqual([
      { title: 'Create a table', language: 'sql', code: 'CREATE TABLE t (id int);' },
      { language: 'ts', code: 'const x = `template ${1}`;' },
    ]);
  });

  it.each([
    ['no front matter', '## Beginner\n\nx', /front matter/],
    ['unknown section', DOC.replace('## Senior', '## Expert'), /unknown section "## Expert"/],
    [
      'text before sections',
      DOC.replace('## Beginner', 'stray\n\n## Beginner'),
      /before the first/,
    ],
    ['empty section', DOC.replace('Deep words.', ''), /is empty/],
    ['bad list', DOC.replace('- First case', 'First case'), /must be a "- " list/],
    ['example without language', DOC.replace('```sql', '```'), /needs a language/],
    ['missing senior text', DOC.replace('## Senior\n\nDeep words.\n', ''), /explain.senior/],
    [
      'quiz answer out of range',
      DOC.replace('answer: 1', 'answer: 5'),
      /answer must index an option/,
    ],
    ['bad reference url', DOC.replace('https://example.com/spec', 'not a url'), /references/],
  ])('rejects %s with a clear message', (_name, text, message) => {
    expect(() => parseLearningDoc(text, 'bad.md')).toThrow(ContentError);
    expect(() => parseLearningDoc(text, 'bad.md')).toThrow(message);
  });
});

describe('evaluateCheck', () => {
  const p = sampleProject();
  const run = (check: Check) =>
    evaluateCheck(p, CheckSchema.parse(check), { catalog: testCatalog });

  it('hasElement with kind, name, parent and where', () => {
    expect(run({ hasElement: { kind: 't.service' } }).passed).toBe(true);
    expect(run({ hasElement: { kind: 't.*' }, min: 6 }).passed).toBe(true);
    expect(run({ hasElement: { kind: 'category:data-at-rest' } }).passed).toBe(true);
    expect(run({ hasElement: { nameIncludes: 'ORD' } }).passed).toBe(true);
    expect(
      run({
        hasElement: {
          kind: 't.adapter',
          parent: { kind: 't.module', parent: { kind: 't.service' } },
        },
      }).passed,
    ).toBe(true);
    expect(
      run({ hasElement: { kind: 't.service', where: { 'properties.framework': 'express' } } })
        .passed,
    ).toBe(true);
    expect(
      run({
        hasElement: { kind: 't.service', where: { 'properties.framework': { in: ['fastify'] } } },
      }).passed,
    ).toBe(false);
    expect(
      run({ hasElement: { kind: 't.service', where: { tech: { exists: false } } } }).passed,
    ).toBe(true);
  });

  it('counts with min and max and explains failures', () => {
    expect(run({ hasElement: { kind: 't.queue' } })).toEqual({
      passed: false,
      failures: ['Expected at least one element (t.queue), found 0'],
    });
    expect(run({ hasElement: { kind: 't.db' }, max: 0 }).failures[0]).toMatch(/at most 0/);
    expect(run({ hasElement: { kind: 't.queue' }, message: 'Add a queue.' }).failures).toEqual([
      'Add a queue.',
    ]);
  });

  it('hasRelation with type, ends and where', () => {
    expect(
      run({ hasRelation: { type: 'writes', from: { kind: 't.adapter' }, to: { kind: 't.db' } } })
        .passed,
    ).toBe(true);
    expect(run({ hasRelation: { type: ['reads', 'writes'], to: { id: 'db.main' } } }).passed).toBe(
      true,
    );
    expect(run({ hasRelation: { type: 'reads', to: { id: 'db.main' } } }).passed).toBe(false);
    expect(
      run({
        hasRelation: {
          type: 'writes',
          where: { 'properties.concurrencyControl': { exists: true } },
        },
      }).passed,
    ).toBe(false);
  });

  it('noPath follows relation direction and type filters', () => {
    expect(run({ noPath: { from: { id: 'app.web' }, to: { id: 'svc.api' } } }).passed).toBe(false);
    expect(run({ noPath: { from: { id: 'svc.api' }, to: { id: 'app.web' } } }).passed).toBe(true);
    expect(
      run({ noPath: { from: { id: 'app.web' }, to: { id: 'svc.api' }, types: ['reads'] } }).passed,
    ).toBe(true);
    expect(run({ noPath: { from: { id: 'app.web' }, to: { id: 'svc.api' } } }).failures[0]).toMatch(
      /app.web → svc.api/,
    );
  });

  it('combines checks with all, any and not', () => {
    expect(
      run({ all: [{ hasElement: { kind: 't.db' } }, { hasElement: { kind: 't.app' } }] }).passed,
    ).toBe(true);
    expect(
      run({ any: [{ hasElement: { kind: 't.queue' } }, { hasElement: { kind: 't.db' } }] }).passed,
    ).toBe(true);
    expect(run({ not: { hasElement: { kind: 't.queue' } } }).passed).toBe(true);
    const failed = run({
      all: [{ hasElement: { kind: 't.queue' } }, { not: { hasElement: { kind: 't.db' } } }],
    });
    expect(failed.failures).toHaveLength(2);
  });

  it('finding checks need findings from the rules engine', () => {
    const check = CheckSchema.parse({ finding: { ruleId: 'AP-016', present: false } });
    expect(evaluateCheck(p, check).passed).toBe(false);
    expect(evaluateCheck(p, check, { findings: [] }).passed).toBe(true);
    expect(
      evaluateCheck(p, check, { findings: [{ ruleId: 'AP-016', targetIds: [] }] }).passed,
    ).toBe(false);
  });

  it('rejects malformed checks', () => {
    expect(CheckSchema.safeParse({ hasElement: { kind: 't.db', surprise: 1 } }).success).toBe(
      false,
    );
    expect(CheckSchema.safeParse({ all: [] }).success).toBe(false);
    expect(CheckSchema.safeParse({ hasElement: {}, hasRelation: {} }).success).toBe(false);
  });
});

describe('lessons', () => {
  const LESSON = `
id: lesson.add-queue
title: Add a queue
summary: Learn to decouple work.
track: concurrency-and-parallelism
level: beginner
minutes: 5
profile: test
conceptIds: [t.queue]
start:
  ops:
    - op: addElement
      element: { id: svc.api, kind: t.service, name: API, status: existing }
steps:
  - id: read
    title: Why queues
    body: Queues let work happen later.
  - id: add
    title: Add a queue
    body: Drag a queue onto the canvas and connect the API to it.
    check:
      hasRelation: { type: publishes, from: { id: svc.api }, to: { kind: t.queue } }
    hints: [Use the Events group of the palette.]
    solution:
      - op: addElement
        element: { id: q.jobs, kind: t.queue, name: Jobs, status: existing }
      - op: addRelation
        relation: { id: rel.api-jobs, type: publishes, sourceId: svc.api, targetId: q.jobs, status: existing }
`;

  it('parses, starts, checks and solves a lesson', () => {
    const lesson = parseLesson(LESSON, 'add-queue.yaml');
    const start = startLesson(lesson, testCatalog, '2026-10-27T00:00:00.000Z');
    expect(start.model.elements.map((e) => e.id)).toEqual(['svc.api']);
    const [read, add] = lesson.steps;
    expect(checkStep(start, read!).passed).toBe(true);
    expect(checkStep(start, add!).passed).toBe(false);
    const solved = applySolution(start, add!, testCatalog);
    expect(checkStep(solved, add!).passed).toBe(true);
  });

  it('rejects lessons with bad IDs, ops or checks', () => {
    expect(() => parseLesson(LESSON.replace('lesson.add-queue', 'add-queue'))).toThrow(
      /Lesson IDs/,
    );
    expect(() => parseLesson(LESSON.replace('op: addRelation', 'op: teleport'))).toThrow(
      ContentError,
    );
    expect(() => parseLesson(LESSON.replace('hasRelation:', 'hasThing:'))).toThrow(ContentError);
  });
});

describe('adaptSolution ("Show me" on the learner’s own model)', () => {
  const lesson = parseLesson(
    `id: lesson.adapt
title: Adapt
summary: Two steps.
track: foundations
level: beginner
minutes: 5
profile: test
conceptIds: [t.service]
start:
  ops: []
steps:
  - id: app
    title: App
    body: Add an app.
    check: { hasElement: { kind: t.app } }
    solution:
      - op: addElement
        element: { id: app.web, kind: t.app, name: Web, status: planned }
  - id: api
    title: API
    body: Add a service and call it.
    check: { hasRelation: { type: calls, from: { kind: t.app }, to: { kind: t.service } } }
    solution:
      - op: addElement
        element: { id: svc.api, kind: t.service, name: API, status: planned }
      - op: addRelation
        relation: { id: rel.web-api, type: calls, sourceId: app.web, targetId: svc.api, status: planned }
`,
    'adapt.yaml',
  );
  const step = lesson.steps[1]!;

  it('maps the lesson’s IDs to the shapes the learner made', () => {
    // The learner named the app "Mine", so its ID is not the lesson's "app.web".
    const project = applySolution(
      startLesson(lesson, testCatalog),
      {
        ...lesson.steps[0]!,
        solution: [
          {
            op: 'addElement',
            element: { id: 'app.mine', kind: 't.app', name: 'Mine', status: 'planned' },
          },
        ],
      },
      testCatalog,
    );
    expect(() => applySolution(project, step, testCatalog)).toThrow();
    const ops = adaptSolution(project, lesson, step);
    const done = applySolution(project, { ...step, solution: ops }, testCatalog);
    expect(checkStep(done, step, { catalog: testCatalog }).passed).toBe(true);
    expect(done.model.relations[0]).toMatchObject({ sourceId: 'app.mine', targetId: 'svc.api' });
  });

  it('skips what the learner already did', () => {
    let project = applySolution(startLesson(lesson, testCatalog), lesson.steps[0]!, testCatalog);
    project = applySolution(
      project,
      {
        ...step,
        solution: [
          {
            op: 'addElement',
            element: { id: 'svc.api', kind: 't.service', name: 'API', status: 'planned' },
          },
        ],
      },
      testCatalog,
    );
    const ops = adaptSolution(project, lesson, step);
    expect(ops.map((o) => o.op)).toEqual(['addRelation']);
  });
});
