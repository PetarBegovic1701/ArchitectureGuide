import { applyOps } from '../ops';
import type { OpError } from '../ops';
import type { Catalog } from '../catalog';
import { createProject } from '../project';
import type { ModelOp, Project } from '../schema';
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

/**
 * The step's solution, adapted to the learner's model for "Show me" (§17.5). Learners name
 * shapes their own way, so their IDs differ from the lesson's: IDs the lesson uses for shapes
 * the learner made are mapped to the learner's shape of the same kind, and arrows to the
 * learner's arrow of the same type between the same shapes. What already exists is skipped.
 */
export function adaptSolution(project: Project, lesson: Lesson, step: LessonStep): ModelOp[] {
  const kinds = new Map<string, string>();
  const relations = new Map<string, { type: string; sourceId: string; targetId: string }>();
  for (const op of [...lesson.start.ops, ...lesson.steps.flatMap((s) => s.solution ?? [])]) {
    if (op.op === 'addElement') kinds.set(op.element.id, op.element.kind);
    if (op.op === 'addRelation') relations.set(op.relation.id, op.relation);
  }
  const ops = step.solution ?? [];
  const elementIds = new Set(project.model.elements.map((e) => e.id));
  const relationIds = new Set(project.model.relations.map((r) => r.id));
  for (const op of ops) if (op.op === 'addElement') elementIds.add(op.element.id);
  const mapped = new Map<string, string>();
  const el = (id: string): string => {
    if (elementIds.has(id)) return id;
    if (mapped.has(id)) return mapped.get(id)!;
    const taken = new Set(mapped.values());
    const match = project.model.elements.find((e) => e.kind === kinds.get(id) && !taken.has(e.id));
    if (!match) return id;
    mapped.set(id, match.id);
    return match.id;
  };
  const sameRelation = (type: string, sourceId: string, targetId: string) =>
    project.model.relations.find(
      (r) => r.type === type && r.sourceId === sourceId && r.targetId === targetId,
    );
  const rel = (id: string): string => {
    if (relationIds.has(id)) return id;
    const spec = relations.get(id);
    return (spec && sameRelation(spec.type, el(spec.sourceId), el(spec.targetId))?.id) ?? id;
  };

  const out: ModelOp[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'addElement':
        if (project.model.elements.some((e) => e.id === op.element.id)) continue;
        out.push(
          op.element.parentId
            ? { ...op, element: { ...op.element, parentId: el(op.element.parentId) } }
            : op,
        );
        break;
      case 'addRelation': {
        const sourceId = el(op.relation.sourceId);
        const targetId = el(op.relation.targetId);
        if (relationIds.has(op.relation.id) || sameRelation(op.relation.type, sourceId, targetId))
          continue;
        out.push({ ...op, relation: { ...op.relation, sourceId, targetId } });
        break;
      }
      case 'updateElement':
      case 'removeElement':
        out.push({ ...op, id: el(op.id) });
        break;
      case 'moveElement':
        out.push({ ...op, id: el(op.id), parentId: op.parentId && el(op.parentId) });
        break;
      case 'updateRelation':
      case 'removeRelation':
        out.push({ ...op, id: rel(op.id) });
        break;
      default:
        out.push(op);
    }
  }
  return out;
}
