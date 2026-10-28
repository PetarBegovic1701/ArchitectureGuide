import { describe, expect, it } from 'vitest';
import {
  LAB_CONTROLS,
  ProgressError,
  completeStep,
  contentCoverage,
  docsInTrack,
  emptyProgress,
  isExercise,
  lessonStatus,
  mergeProgress,
  parseProgress,
  searchDocs,
  simulateConcurrency,
  trackSummaries,
} from '.';
import type { LearningDoc, Lesson } from '.';
import { testCatalog } from '../test-support/fixtures';

const doc = (id: string, extra: Partial<LearningDoc> = {}): LearningDoc => ({
  id,
  kind: 'topic',
  title: id,
  summary: `About ${id}.`,
  level: 'beginner',
  tracks: ['foundations'],
  explain: { beginner: 'Plain text.', senior: 'Deep text.' },
  related: [],
  references: [{ title: 'Spec', url: 'https://example.com' }],
  ...extra,
});

const lesson = (id: string, extra: Partial<Lesson> = {}): Lesson => ({
  id,
  title: id,
  summary: 'A lesson.',
  track: 'foundations',
  level: 'beginner',
  minutes: 10,
  profile: 'test',
  conceptIds: ['t.service'],
  start: { ops: [] },
  steps: [
    { id: 'one', title: 'One', body: 'Read.' },
    { id: 'two', title: 'Two', body: 'Do.', check: { hasElement: { kind: 't.service' } } },
  ],
  ...extra,
});

describe('library', () => {
  const docs = [
    doc('topic.caching', { title: 'Caching', summary: 'Keep copies close.', tags: ['redis'] }),
    doc('topic.queues', {
      title: 'Job queues',
      level: 'intermediate',
      tracks: ['concurrency-and-parallelism'],
      explain: { beginner: 'Work later, with caching of results.', senior: 'Deep.' },
    }),
    doc('topic.basics', { title: 'Basics' }),
  ];

  it('lists a track beginner texts first', () => {
    expect(docsInTrack(docs, 'foundations').map((d) => d.id)).toEqual([
      'topic.basics',
      'topic.caching',
    ]);
  });

  it('ranks title matches above body matches and needs every word', () => {
    expect(searchDocs(docs, 'caching').map((d) => d.id)).toEqual(['topic.caching', 'topic.queues']);
    expect(searchDocs(docs, 'redis').map((d) => d.id)).toEqual(['topic.caching']);
    expect(searchDocs(docs, 'caching redis').map((d) => d.id)).toEqual(['topic.caching']);
    expect(searchDocs(docs, '  ')).toHaveLength(3);
  });

  it('reports coverage of concepts, relation types and rules', () => {
    const c = contentCoverage(
      testCatalog,
      [doc('t.service', { kind: 'concept' })],
      [{ id: 'AP-001' } as never],
    );
    expect(c.concepts.covered).toBe(1);
    expect(c.concepts.missing).not.toContain('t.service');
    expect(c.relationTypes.covered).toBe(0);
    expect(c.rules).toEqual({ covered: 0, total: 1, missing: ['AP-001'] });
  });

  it('knows an exercise: a flawed start model graded by findings', () => {
    expect(isExercise(lesson('lesson.a'))).toBe(false);
    const graded = lesson('lesson.b', {
      start: {
        ops: [
          {
            op: 'addElement',
            element: { id: 'svc.a', kind: 't.service', name: 'A', status: 'existing' },
          },
        ],
      },
      steps: [
        {
          id: 'fix',
          title: 'Fix',
          body: 'Fix it.',
          check: { all: [{ finding: { ruleId: 'AP-001', present: false } }] },
        },
      ],
    });
    expect(isExercise(graded)).toBe(true);
  });
});

describe('progress', () => {
  const NOW = '2026-10-28T10:00:00.000Z';
  const LATER = '2026-10-28T11:00:00.000Z';
  const l = lesson('lesson.a');

  it('moves through a lesson and finishes it at the last step', () => {
    let p = emptyProgress();
    expect(lessonStatus(p, l.id)).toBe('new');
    p = completeStep(p, l, 'one', NOW);
    expect(p.lessons[l.id]).toMatchObject({ step: 1, completed: ['one'] });
    expect(lessonStatus(p, l.id)).toBe('started');
    p = completeStep(p, l, 'two', LATER);
    expect(p.lessons[l.id]).toMatchObject({
      step: 1,
      completed: ['one', 'two'],
      finishedAt: LATER,
    });
    expect(lessonStatus(p, l.id)).toBe('finished');
    // Completing a step again changes nothing.
    expect(completeStep(p, l, 'two', LATER)).toEqual(p);
  });

  it('round-trips through JSON and refuses other files with a readable message', () => {
    const p = completeStep(emptyProgress(), l, 'one', NOW);
    expect(parseProgress(JSON.stringify(p))).toEqual(p);
    expect(() => parseProgress('nope')).toThrow(ProgressError);
    expect(() => parseProgress('{"format":"archguide-project"}')).toThrow(
      /not an ArchitectureGuide progress file/,
    );
  });

  it('merges two files without losing anything', () => {
    const a = { ...completeStep(emptyProgress(), l, 'one', NOW), read: { 'topic.x': LATER } };
    const b = {
      ...completeStep(completeStep(emptyProgress(), l, 'one', LATER), l, 'two', LATER),
      read: { 'topic.x': NOW, 'topic.y': NOW },
      quiz: { 'topic.x#0': { answer: 1, correct: true, at: LATER } },
    };
    const m = mergeProgress(a, b);
    expect(m.lessons[l.id]!.completed).toEqual(['one', 'two']);
    expect(m.lessons[l.id]!.finishedAt).toBe(LATER);
    expect(m.lessons[l.id]!.startedAt).toBe(NOW);
    expect(m.read).toEqual({ 'topic.x': NOW, 'topic.y': NOW });
    expect(m.quiz['topic.x#0']!.correct).toBe(true);
  });

  it('summarizes tracks with finished counts and minutes', () => {
    const lessons = [lesson('lesson.a'), lesson('lesson.b', { level: 'intermediate', minutes: 5 })];
    let p = completeStep(emptyProgress(), lessons[0]!, 'one', NOW);
    p = completeStep(p, lessons[0]!, 'two', NOW);
    expect(trackSummaries(lessons, p, ['foundations', 'auth'])).toEqual([
      { track: 'foundations', lessons, finished: 1, minutes: 15 },
    ]);
  });
});

describe('concurrency lab', () => {
  it('loses an update without concurrency control', () => {
    const run = simulateConcurrency('none');
    expect(run).toMatchObject({ initial: 5, expected: 3, final: 4, lostUpdates: 1, retries: 0 });
    expect(run.lanes).toEqual(['Request A', 'Request B']);
    expect(run.summary).toMatch(/^Lost update/);
  });

  it.each(LAB_CONTROLS.filter((c) => c.id !== 'none').map((c) => c.id))(
    '%s keeps the stock correct for 2 and 3 requests',
    (control) => {
      for (const requests of [2, 3]) {
        const run = simulateConcurrency(control, { requests });
        expect(run.final, `${control} with ${requests}`).toBe(5 - requests);
        expect(run.lostUpdates).toBe(0);
      }
    },
  );

  it('retries with a version check or SERIALIZABLE, and waits with a lock', () => {
    expect(simulateConcurrency('optimistic-version', { requests: 3 }).retries).toBe(3);
    expect(simulateConcurrency('serializable-retry').retries).toBe(1);
    const locked = simulateConcurrency('row-lock', { requests: 3 });
    expect(locked.retries).toBe(0);
    expect(locked.waited).toBeGreaterThan(0);
    expect(locked.steps.filter((s) => s.kind === 'wait')).toHaveLength(2);
  });

  it('lays out every step inside the timeline, one at a time per lane', () => {
    for (const { id } of LAB_CONTROLS) {
      const run = simulateConcurrency(id, { requests: 3 });
      for (const lane of [0, 1, 2]) {
        const mine = run.steps.filter((s) => s.lane === lane);
        for (let i = 1; i < mine.length; i++)
          expect(mine[i]!.t, `${id} lane ${lane}`).toBeGreaterThanOrEqual(
            mine[i - 1]!.t + mine[i - 1]!.duration,
          );
      }
      expect(Math.max(...run.steps.map((s) => s.t + s.duration))).toBe(run.length);
    }
  });
});
