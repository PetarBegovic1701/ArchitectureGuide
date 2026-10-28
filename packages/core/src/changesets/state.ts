import type { Catalog } from '../catalog';
import { diffProjects } from '../diff';
import type { ProjectDiff } from '../diff';
import { slugify, uniqueId } from '../ids';
import { applyOps } from '../ops';
import type { OpErrorCode } from '../ops';
import { runRules } from '../rules';
import type { Finding } from '../rules';
import type { ChangeSet, Id, ModelOp, Op, Project } from '../schema';
import { newFindings } from '../tools/findings';

/** An op of a change set that no longer applies to the baseline (Implementation.md §16.2). */
export interface Conflict {
  /** Index of the op in `changeSet.ops`. */
  index: number;
  op: ModelOp;
  code: OpErrorCode;
  message: string;
}

/** Baseline + change set: what the model will be once the change is built. */
export interface ChangeSetState {
  changeSet: ChangeSet;
  baseline: Project;
  effective: Project;
  /** Ops that fail on the current baseline; they are left out of `effective`. */
  conflicts: Conflict[];
  /** The baseline changed after the change set was made. */
  stale: boolean;
}

/** A new, empty draft change set on top of the project's current revision. */
export function createChangeSet(
  project: Project,
  input: { name: string; description?: string; id?: Id; now?: string },
): ChangeSet {
  const taken = new Set(project.changeSets.map((c) => c.id));
  return {
    id: input.id ?? uniqueId(`cs.${slugify(input.name)}`, taken),
    name: input.name,
    description: input.description ?? '',
    status: 'draft',
    baseRevision: project.revision,
    ops: [],
    createdAt: input.now ?? new Date().toISOString(),
  };
}

/**
 * The change set as a write stores it on top of `baseline`. Every write bumps the project
 * revision by one, the write that saves the change set too; so a change set that was up to
 * date moves to that next revision and is not "stale" because of its own save.
 */
export function storedChangeSet(changeSet: ChangeSet, baseline: Project): ChangeSet {
  return changeSet.baseRevision >= baseline.revision
    ? { ...changeSet, baseRevision: baseline.revision + 1 }
    : changeSet;
}

export function findChangeSet(project: Project, id: Id): ChangeSet | undefined {
  return project.changeSets.find((c) => c.id === id);
}

/**
 * Applies the change set's ops to the baseline. Ops that fail (an element they edit was
 * removed from the baseline, say) are skipped and reported as conflicts; the rest apply.
 */
export function effectiveProject(
  baseline: Project,
  changeSet: ChangeSet,
  catalog: Catalog,
): ChangeSetState {
  const all = applyOps(baseline, changeSet.ops, catalog);
  const state = (effective: Project, conflicts: Conflict[]): ChangeSetState => ({
    changeSet,
    baseline,
    effective,
    conflicts,
    stale: changeSet.baseRevision < baseline.revision,
  });
  if (all.ok) return state(all.project, []);
  let current = baseline;
  const conflicts: Conflict[] = [];
  for (const [index, op] of changeSet.ops.entries()) {
    const r = applyOps(current, [op], catalog);
    if (r.ok) current = r.project;
    else conflicts.push({ index, op, code: r.errors[0]!.code, message: r.errors[0]!.message });
  }
  return state(current, conflicts);
}

/** The overlay: what the change set adds, changes and removes (§16.3). */
export function changeSetDiff(state: ChangeSetState): ProjectDiff {
  return diffProjects(state.baseline, state.effective);
}

/** Rule findings on baseline + change, and the ones the change introduces (§16.1). */
export function changeSetFindings(
  state: ChangeSetState,
  catalog: Catalog,
): { all: Finding[]; introduced: Finding[] } {
  const all = runRules(state.effective, catalog);
  return { all, introduced: newFindings(runRules(state.baseline, catalog), all) };
}

const VIEW_ONLY = new Set(['setViewNode', 'setViewEdge']);
const viewKey = (op: ModelOp) =>
  op.op === 'setViewNode'
    ? `n:${op.viewId}:${op.node.elementId}`
    : op.op === 'setViewEdge'
      ? `e:${op.viewId}:${op.edge.relationId}`
      : undefined;
const primitivePatch = (patch: Record<string, unknown>) =>
  Object.values(patch).every((v) => v === null || typeof v !== 'object');

/**
 * `existing` + `added`, compacted so a drag or typing a name does not leave hundreds of
 * ops: a placement replaces an earlier placement of the same shape in the trailing run of
 * view ops, and an update of the same simple fields of the same element replaces the
 * previous one.
 */
export function appendOps(existing: readonly ModelOp[], added: readonly ModelOp[]): ModelOp[] {
  const out = [...existing];
  for (const op of added) {
    const key = viewKey(op);
    if (key) {
      for (let i = out.length - 1; i >= 0 && VIEW_ONLY.has(out[i]!.op); i--)
        if (viewKey(out[i]!) === key) {
          out.splice(i, 1);
          break;
        }
    }
    const last = out.at(-1);
    if (
      op.op === 'updateElement' &&
      last?.op === 'updateElement' &&
      last.id === op.id &&
      primitivePatch(op.patch) &&
      primitivePatch(last.patch) &&
      Object.keys(op.patch).sort().join() === Object.keys(last.patch).sort().join()
    ) {
      out[out.length - 1] = op;
      continue;
    }
    out.push(op);
  }
  return out;
}

/**
 * The change set with new ops recorded at the end, or the errors when they do not apply on
 * top of what the change set already does.
 */
export function recordOps(
  baseline: Project,
  changeSet: ChangeSet,
  ops: readonly ModelOp[],
  catalog: Catalog,
): { ok: true; changeSet: ChangeSet } | { ok: false; message: string } {
  const state = effectiveProject(baseline, changeSet, catalog);
  const r = applyOps(state.effective, ops, catalog);
  if (!r.ok) return { ok: false, message: r.errors[0]?.message ?? 'The change does not apply.' };
  return { ok: true, changeSet: { ...changeSet, ops: appendOps(changeSet.ops, ops) } };
}

/**
 * Re-validates the ops on the current baseline (§16.2). The change set moves to the current
 * revision (as stored by the next write); conflicting ops stay in it until the user fixes or
 * drops them.
 */
export function rebaseChangeSet(
  baseline: Project,
  changeSet: ChangeSet,
  catalog: Catalog,
): { changeSet: ChangeSet; conflicts: Conflict[] } {
  const { conflicts } = effectiveProject(baseline, changeSet, catalog);
  return {
    changeSet: storedChangeSet({ ...changeSet, baseRevision: baseline.revision }, baseline),
    conflicts,
  };
}

/** The change set without the ops at these indexes (fixing conflicts by hand). */
export function dropOps(changeSet: ChangeSet, indexes: readonly number[]): ChangeSet {
  const drop = new Set(indexes);
  return { ...changeSet, ops: changeSet.ops.filter((_, i) => !drop.has(i)) };
}

/**
 * Ops that merge the change set into the baseline and mark it implemented ("Apply to
 * baseline"). Refused while ops conflict.
 */
export function applyChangeSetOps(
  baseline: Project,
  changeSet: ChangeSet,
  catalog: Catalog,
): { ok: true; ops: Op[] } | { ok: false; conflicts: Conflict[] } {
  const { conflicts } = effectiveProject(baseline, changeSet, catalog);
  if (conflicts.length) return { ok: false, conflicts };
  return {
    ok: true,
    ops: [
      ...changeSet.ops,
      {
        op: 'upsertChangeSet',
        changeSet: { ...changeSet, status: 'implemented', baseRevision: baseline.revision },
      },
    ],
  };
}
