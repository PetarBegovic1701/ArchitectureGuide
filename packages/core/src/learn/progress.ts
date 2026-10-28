import { z } from 'zod';
import type { Lesson, Track } from './schema';

/**
 * A learner's progress, kept per browser and exported as JSON (Implementation.md §17.9):
 * lessons (current step, finished steps, the project they run in), texts read, quiz answers.
 */
export const LessonProgressSchema = z.object({
  /** The browser project the lesson runs in. */
  projectId: z.string().min(1).optional(),
  /** Index of the step the learner is on. */
  step: z.number().int().nonnegative(),
  /** IDs of finished steps. */
  completed: z.array(z.string().min(1)),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
});
export type LessonProgress = z.infer<typeof LessonProgressSchema>;

export const QuizAnswerSchema = z.object({
  answer: z.number().int().nonnegative(),
  correct: z.boolean(),
  at: z.string(),
});
export type QuizAnswer = z.infer<typeof QuizAnswerSchema>;

export const ProgressSchema = z.object({
  format: z.literal('archguide-progress'),
  version: z.literal(1),
  lessons: z.record(z.string(), LessonProgressSchema),
  /** Text ID → when it was first read. */
  read: z.record(z.string(), z.string()),
  /** `${textId}#${questionIndex}` → the last answer. */
  quiz: z.record(z.string(), QuizAnswerSchema),
});
export type Progress = z.infer<typeof ProgressSchema>;

export function emptyProgress(): Progress {
  return { format: 'archguide-progress', version: 1, lessons: {}, read: {}, quiz: {} };
}

export class ProgressError extends Error {}

/** Reads an exported progress file. Throws `ProgressError` with a readable message. */
export function parseProgress(text: string): Progress {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProgressError('This file is not JSON.');
  }
  const result = ProgressSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new ProgressError(
      `This is not an ArchitectureGuide progress file (${issue.path.join('.') || 'file'}: ${issue.message}).`,
    );
  }
  return result.data;
}

/**
 * Combines two progress files: the union of read texts and finished steps, the later quiz
 * answer, and per lesson the one that is further along.
 */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const lessons: Progress['lessons'] = { ...a.lessons };
  for (const [id, theirs] of Object.entries(b.lessons)) {
    const ours = lessons[id];
    if (!ours) {
      lessons[id] = theirs;
      continue;
    }
    const ahead = theirs.completed.length > ours.completed.length ? theirs : ours;
    lessons[id] = {
      ...ahead,
      completed: [...new Set([...ours.completed, ...theirs.completed])],
      startedAt: ours.startedAt < theirs.startedAt ? ours.startedAt : theirs.startedAt,
      ...(ours.finishedAt || theirs.finishedAt
        ? { finishedAt: [ours.finishedAt, theirs.finishedAt].filter(Boolean).sort()[0] }
        : {}),
    };
  }
  const read = { ...b.read, ...a.read };
  for (const [id, at] of Object.entries(b.read)) if (a.read[id] && at < a.read[id]) read[id] = at;
  const quiz = { ...a.quiz };
  for (const [key, answer] of Object.entries(b.quiz))
    if (!quiz[key] || quiz[key].at < answer.at) quiz[key] = answer;
  return { ...emptyProgress(), lessons, read, quiz };
}

export type LessonStatus = 'new' | 'started' | 'finished';

export function lessonStatus(progress: Progress, lessonId: string): LessonStatus {
  const p = progress.lessons[lessonId];
  return !p ? 'new' : p.finishedAt ? 'finished' : 'started';
}

/** Records a passed step and moves to the next one. Finishing the last step finishes the lesson. */
export function completeStep(
  progress: Progress,
  lesson: Lesson,
  stepId: string,
  now: string,
): Progress {
  const current = progress.lessons[lesson.id] ?? { step: 0, completed: [], startedAt: now };
  const completed = current.completed.includes(stepId)
    ? current.completed
    : [...current.completed, stepId];
  const index = lesson.steps.findIndex((s) => s.id === stepId);
  const last = index === lesson.steps.length - 1;
  return {
    ...progress,
    lessons: {
      ...progress.lessons,
      [lesson.id]: {
        ...current,
        completed,
        step: last ? index : Math.max(current.step, index + 1),
        ...(last && !current.finishedAt ? { finishedAt: now } : {}),
      },
    },
  };
}

export interface TrackSummary {
  track: Track;
  lessons: Lesson[];
  finished: number;
  minutes: number;
}

/** Lessons per track, easiest first, with how many the learner finished. */
export function trackSummaries(
  lessons: readonly Lesson[],
  progress: Progress,
  tracks: readonly Track[],
): TrackSummary[] {
  const order = { beginner: 0, intermediate: 1, senior: 2 } as const;
  return tracks
    .map((track) => {
      const list = lessons
        .filter((l) => l.track === track)
        .sort((a, b) => order[a.level] - order[b.level] || a.title.localeCompare(b.title));
      return {
        track,
        lessons: list,
        finished: list.filter((l) => lessonStatus(progress, l.id) === 'finished').length,
        minutes: list.reduce((sum, l) => sum + l.minutes, 0),
      };
    })
    .filter((t) => t.lessons.length > 0);
}

/** Stable JSON for export and storage: keys sorted, two-space indent. */
export function serializeProgress(progress: Progress): string {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => [k, sort(v)]),
          )
        : value;
  return `${JSON.stringify(sort(progress), null, 2)}\n`;
}

/** Marks a text as read (keeps the first time). */
export function markRead(progress: Progress, docId: string, now: string): Progress {
  return progress.read[docId]
    ? progress
    : { ...progress, read: { ...progress.read, [docId]: now } };
}

/** Records a quiz answer. */
export function answerQuiz(
  progress: Progress,
  docId: string,
  question: number,
  answer: number,
  correct: boolean,
  now: string,
): Progress {
  return {
    ...progress,
    quiz: { ...progress.quiz, [`${docId}#${question}`]: { answer, correct, at: now } },
  };
}
