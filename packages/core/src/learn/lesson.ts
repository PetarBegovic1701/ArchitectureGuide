import { applyOps } from '../ops';
import type { OpError } from '../ops';
import type { Catalog } from '../catalog';
import { createProject } from '../project';
import type { Project } from '../schema';
import { evaluateCheck } from './check';
import type { CheckContext, CheckResult } from './check';
import type { Lesson, LessonStep } from './schema';

export class LessonError extends Error {
  constructor(
    message: string,
    readonly errors: OpError[] = [],
  ) {
    super(message);
  }
}

/** The project a lesson starts from: an empty project plus the lesson's start ops. */
export function startLesson(lesson: Lesson, catalog: Catalog, now?: string): Project {
  const empty = createProject({
    id: 'lesson',
    name: lesson.title,
    profile: lesson.profile,
    ...(now ? { now } : {}),
  });
  const result = applyOps(empty, lesson.start.ops, catalog);
  if (!result.ok) throw new LessonError(`${lesson.id}: start ops fail`, result.errors);
  return result.project;
}

/** Whether a step is done. Reading steps (no check) are always done. */
export function checkStep(project: Project, step: LessonStep, ctx: CheckContext = {}): CheckResult {
  return step.check ? evaluateCheck(project, step.check, ctx) : { passed: true, failures: [] };
}

/** Applies a step's solution ("Show me"). */
export function applySolution(project: Project, step: LessonStep, catalog: Catalog): Project {
  if (!step.solution) throw new LessonError(`Step "${step.id}" has no solution`);
  const result = applyOps(project, step.solution, catalog);
  if (!result.ok) throw new LessonError(`Solution of step "${step.id}" fails`, result.errors);
  return result.project;
}
