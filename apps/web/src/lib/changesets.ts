import { useMemo } from 'react';
import {
  applyChangeSetOps,
  createChangeSet,
  describeOp,
  diffProjects,
  dropOps,
  effectiveProject,
  generateTasks,
  newFindings,
  rebaseChangeSet,
  runRules,
  storedChangeSet,
} from '@archguide/core';
import type { ChangeSet, ChangeSetState, Finding, Id, Project, Task } from '@archguide/core';
import { catalog } from './catalog';
import { dispatch } from '../actions';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

/** What the change set adds, changes and removes, for the canvas overlay (§16.1). */
export interface Overlay {
  added: ReadonlySet<Id>;
  changed: ReadonlySet<Id>;
  removed: ReadonlySet<Id>;
}

export function overlayOf(baseline: Project, shown: Project): Overlay {
  const d = diffProjects(baseline, shown);
  return {
    added: new Set([...d.added.elements, ...d.added.relations]),
    changed: new Set(d.changed.map((c) => c.id)),
    removed: new Set([...d.removed.elements, ...d.removed.relations]),
  };
}

/** The active change set, or undefined outside change-set mode. */
export function useActiveChangeSet(): ChangeSet | undefined {
  const id = useProject((s) => s.changeSetId);
  const baseline = useProject((s) => s.baseline);
  return id ? baseline?.changeSets.find((c) => c.id === id) : undefined;
}

/** The overlay while a change set is active. */
export function useOverlay(): Overlay | null {
  const id = useProject((s) => s.changeSetId);
  const baseline = useProject((s) => s.baseline);
  const shown = useProject((s) => s.project);
  return useMemo(
    () => (id && baseline && shown ? overlayOf(baseline, shown) : null),
    [id, baseline, shown],
  );
}

/** Findings on baseline + change that the change introduces (keys as in lib/findings). */
export function introducedFindings(baseline: Project, shown: Project): Finding[] {
  return newFindings(runRules(baseline, catalog), runRules(shown, catalog));
}

export function stateOf(baseline: Project, cs: ChangeSet): ChangeSetState {
  return effectiveProject(baseline, cs, catalog);
}

export const opText = describeOp;

const store = () => useProject.getState();
const toast = (tone: 'success' | 'error' | 'info', message: string) =>
  useUi.getState().toast({ tone, message });

/** Saves a change set (any field), as one undo step on the baseline. */
function save(cs: ChangeSet, label: string): boolean {
  const baseline = store().baseline;
  if (!baseline) return false;
  return dispatch([{ op: 'upsertChangeSet', changeSet: storedChangeSet(cs, baseline) }], {
    label,
  });
}

/** Starts a change set and switches the editor to it. */
export function startChangeSet(name: string, description = ''): Id | undefined {
  const baseline = store().baseline;
  if (!baseline || !name.trim()) return undefined;
  const cs = createChangeSet(baseline, { name: name.trim(), description });
  if (!save(cs, `Start change set ${cs.name}`)) return undefined;
  store().enterChangeSet(cs.id);
  return cs.id;
}

export function updateChangeSet(id: Id, patch: Partial<ChangeSet>, label = 'Edit change set') {
  const cs = store().baseline?.changeSets.find((c) => c.id === id);
  if (cs) save({ ...cs, ...patch }, label);
}

export function setTasks(id: Id, tasks: Task[]) {
  updateChangeSet(id, { tasks }, 'Edit tasks');
}

/** (Re)generates the tasks; ticked tasks stay ticked (§16.4). */
export function regenerateTasks(id: Id) {
  const baseline = store().baseline;
  const cs = baseline?.changeSets.find((c) => c.id === id);
  if (!baseline || !cs) return;
  setTasks(id, generateTasks(baseline, cs, catalog));
}

/** Moves a task up or down; a task that another needs first cannot pass it. */
export function moveTask(id: Id, taskId: Id, by: -1 | 1) {
  const tasks = store().baseline?.changeSets.find((c) => c.id === id)?.tasks ?? [];
  const i = tasks.findIndex((t) => t.id === taskId);
  const j = i + by;
  if (i < 0 || j < 0 || j >= tasks.length) return;
  // The later of the two moves before the earlier one.
  const [earlier, later] = by < 0 ? [tasks[j]!, tasks[i]!] : [tasks[i]!, tasks[j]!];
  if (later.dependsOn.includes(earlier.id)) {
    toast('error', `“${later.title}” needs “${earlier.title}” first.`);
    return;
  }
  setTasks(id, swap(tasks, i, j));
}

const swap = <T>(list: readonly T[], i: number, j: number): T[] => {
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

/** Merges a task into the one before it (their elements, steps and needs). */
export function mergeWithPrevious(id: Id, taskId: Id) {
  const cs = store().baseline?.changeSets.find((c) => c.id === id);
  const tasks = cs?.tasks ?? [];
  const i = tasks.findIndex((t) => t.id === taskId);
  if (i < 1) return;
  const [prev, cur] = [tasks[i - 1]!, tasks[i]!];
  const merged: Task = {
    ...prev,
    title: `${prev.title} + ${cur.title.replace(/^(Create|Change|Build|Remove) /, '')}`,
    detail: [prev.detail, cur.detail].filter(Boolean).join('\n'),
    elementIds: [...new Set([...prev.elementIds, ...cur.elementIds])],
    dependsOn: [...new Set([...prev.dependsOn, ...cur.dependsOn])].filter(
      (d) => d !== prev.id && d !== cur.id,
    ),
    done: prev.done && cur.done,
  };
  setTasks(
    id,
    tasks
      .flatMap((t, k) => (k === i ? [] : k === i - 1 ? [merged] : [t]))
      .map((t) => ({
        ...t,
        dependsOn: [...new Set(t.dependsOn.map((d) => (d === cur.id ? prev.id : d)))].filter(
          (d) => d !== t.id,
        ),
      })),
  );
}

/** Drops the ops that no longer apply, or moves the change set to the current baseline. */
export function dropConflicts(id: Id, indexes: readonly number[]) {
  const cs = store().baseline?.changeSets.find((c) => c.id === id);
  if (cs) save(dropOps(cs, indexes), 'Drop conflicting changes');
}

export function rebase(id: Id) {
  const baseline = store().baseline;
  const cs = baseline?.changeSets.find((c) => c.id === id);
  if (!baseline || !cs) return;
  const r = rebaseChangeSet(baseline, cs, catalog);
  save(r.changeSet, 'Rebase change set');
  toast(
    r.conflicts.length ? 'info' : 'success',
    r.conflicts.length
      ? `Rebased; ${r.conflicts.length} change(s) still conflict.`
      : 'Rebased on the current baseline.',
  );
}

/** Merges the change set into the baseline and marks it implemented (§16.2). */
export function applyToBaseline(id: Id): boolean {
  const baseline = store().baseline;
  const cs = baseline?.changeSets.find((c) => c.id === id);
  if (!baseline || !cs) return false;
  const r = applyChangeSetOps(baseline, cs, catalog);
  if (!r.ok) {
    toast('error', `${r.conflicts.length} change(s) conflict with the baseline: fix them first.`);
    return false;
  }
  if (!dispatch(r.ops, { label: `Apply ${cs.name}` })) return false;
  toast('success', `Applied “${cs.name}” to the baseline.`);
  return true;
}

export function removeChangeSet(id: Id) {
  if (store().changeSetId === id) store().leaveChangeSet();
  dispatch([{ op: 'removeChangeSet', id }], { label: 'Delete change set' });
}
