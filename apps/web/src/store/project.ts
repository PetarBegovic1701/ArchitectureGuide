import { create } from 'zustand';
import { appendOps, applyOps, effectiveProject, storedChangeSet } from '@archguide/core';
import type { Id, ModelOp, Op, OpError, Project } from '@archguide/core';
import { catalog } from '../lib/catalog';

export interface HistoryEntry {
  label: string;
  ops: Op[];
  inverse: Op[];
  mergeKey?: string;
}

export interface Selection {
  elements: Id[];
  relations: Id[];
}

const HISTORY_LIMIT = 200;

/** Serve mode: gets every change made in this tab (dispatch, undo, redo) to send it. */
let localChanges: ((ops: Op[]) => void) | null = null;
export function onLocalChanges(listener: ((ops: Op[]) => void) | null): void {
  localChanges = listener;
}

const isChangeSetOp = (op: Op) => op.op === 'upsertChangeSet' || op.op === 'removeChangeSet';

/** What the canvas shows: the baseline, or baseline + the active change set (§16.1). */
function shownOf(baseline: Project, changeSetId: Id | null): Project {
  const id = openChangeSet(baseline, changeSetId);
  const cs = id ? baseline.changeSets.find((c) => c.id === id) : undefined;
  return cs ? effectiveProject(baseline, cs, catalog).effective : baseline;
}

/** The ID when that change set still exists and is open (draft or ready). */
function openChangeSet(p: Project, id: Id | null): Id | null {
  const cs = id ? p.changeSets.find((c) => c.id === id) : undefined;
  return cs && (cs.status === 'draft' || cs.status === 'ready') ? cs.id : null;
}

interface ProjectState {
  /**
   * What the editor shows and edits. Outside change-set mode this is the saved project;
   * in change-set mode it is baseline + change set.
   */
  project: Project | null;
  /** The saved project: what autosave, snapshots and serve mode use. */
  baseline: Project | null;
  /** The change set edits are recorded into, if any. */
  changeSetId: Id | null;
  viewId: Id;
  past: HistoryEntry[];
  future: HistoryEntry[];
  selection: Selection;
  /** Increases on every change; autosave watches it. */
  version: number;
  load(project: Project): void;
  unload(): void;
  /**
   * Validates and applies ops as one undo step (Implementation.md §13.2). Consecutive
   * dispatches with the same `mergeKey` become one step (a drag, a create + rename).
   */
  dispatch(ops: Op[], meta?: { label?: string; mergeKey?: string }): OpError[];
  undo(): void;
  redo(): void;
  select(selection: Selection): void;
  /** Shows another view of the project. */
  setView(viewId: Id): void;
  /** Records a finished save. Does not count as a change or touch history. */
  markSaved(revision: number, updatedAt: string): void;
  /** Changes data that is not part of the undo history (the snapshot list); saved as usual. */
  patchSilently(patch: Pick<Partial<Project>, 'snapshots'>): void;
  /** Edits go into this change set; the canvas shows baseline + change set. */
  enterChangeSet(id: Id): void;
  leaveChangeSet(): void;
  /** Replaces the whole project (restoring a snapshot). History starts over. */
  replace(project: Project): void;
  /** Serve mode: ops from MCP, the CLI or another tab. Not an undo step. */
  applyRemote(ops: Op[], revision: number): boolean;
  /** Serve mode: the server's version replaces this tab's copy; history starts over. */
  replaceRemote(project: Project): void;
}

export const useProject = create<ProjectState>((set, get) => ({
  project: null,
  baseline: null,
  changeSetId: null,
  viewId: 'main',
  past: [],
  future: [],
  selection: { elements: [], relations: [] },
  version: 0,

  load(project) {
    set({
      project,
      baseline: project,
      changeSetId: null,
      viewId: project.views[0]?.id ?? 'main',
      past: [],
      future: [],
      selection: { elements: [], relations: [] },
      version: 0,
    });
  },

  unload() {
    set({
      project: null,
      baseline: null,
      changeSetId: null,
      past: [],
      future: [],
      selection: { elements: [], relations: [] },
    });
  },

  dispatch(input, meta = {}) {
    const { project, baseline, changeSetId, past, version } = get();
    if (!project || !baseline || input.length === 0) return [];
    // History and the server get ops on the saved project. In change-set mode, model edits
    // become one upsert of the change set with the ops recorded (§16.1).
    let ops = input;
    let shown: Project;
    let result: ReturnType<typeof applyOps>;
    const open = openChangeSet(baseline, changeSetId);
    const cs = open ? baseline.changeSets.find((c) => c.id === open) : undefined;
    if (cs && !input.some(isChangeSetOp)) {
      const trial = applyOps(project, input, catalog);
      if (!trial.ok) return trial.errors;
      const next = storedChangeSet({ ...cs, ops: appendOps(cs.ops, input as ModelOp[]) }, baseline);
      ops = [{ op: 'upsertChangeSet', changeSet: next }];
      result = applyOps(baseline, ops, catalog);
      if (!result.ok) return result.errors;
      shown = { ...trial.project, changeSets: result.project.changeSets };
    } else {
      result = applyOps(baseline, ops, catalog);
      if (!result.ok) return result.errors;
      shown = shownOf(result.project, openChangeSet(result.project, changeSetId));
    }
    const last = past[past.length - 1];
    const entry: HistoryEntry =
      meta.mergeKey && last?.mergeKey === meta.mergeKey
        ? { ...last, ops: [...last.ops, ...ops], inverse: [...result.inverse, ...last.inverse] }
        : {
            label: meta.label ?? ops[0]!.op,
            ops,
            inverse: result.inverse,
            ...(meta.mergeKey ? { mergeKey: meta.mergeKey } : {}),
          };
    const nextPast =
      meta.mergeKey && last?.mergeKey === meta.mergeKey
        ? [...past.slice(0, -1), entry]
        : [...past, entry];
    set({
      project: shown,
      baseline: result.project,
      changeSetId: openChangeSet(result.project, changeSetId),
      past: nextPast.slice(-HISTORY_LIMIT),
      future: [],
      version: version + 1,
      selection: pruneSelection(shown, get().selection),
    });
    localChanges?.(ops);
    return [];
  },

  undo() {
    const { baseline, changeSetId, past, future, version } = get();
    const entry = past[past.length - 1];
    if (!baseline || !entry) return;
    const result = applyOps(baseline, entry.inverse, catalog);
    if (!result.ok) return;
    const shown = shownOf(result.project, changeSetId);
    set({
      project: shown,
      baseline: result.project,
      changeSetId: openChangeSet(result.project, changeSetId),
      past: past.slice(0, -1),
      future: [...future, { label: entry.label, ops: entry.ops, inverse: entry.inverse }],
      version: version + 1,
      selection: pruneSelection(shown, get().selection),
    });
    localChanges?.(entry.inverse);
  },

  redo() {
    const { baseline, changeSetId, past, future, version } = get();
    const entry = future[future.length - 1];
    if (!baseline || !entry) return;
    const result = applyOps(baseline, entry.ops, catalog);
    if (!result.ok) return;
    const shown = shownOf(result.project, changeSetId);
    set({
      project: shown,
      baseline: result.project,
      changeSetId: openChangeSet(result.project, changeSetId),
      past: [...past, { label: entry.label, ops: entry.ops, inverse: result.inverse }],
      future: future.slice(0, -1),
      version: version + 1,
      selection: pruneSelection(shown, get().selection),
    });
    localChanges?.(entry.ops);
  },

  select(selection) {
    set({ selection });
  },

  setView(viewId) {
    if (get().project?.views.some((v) => v.id === viewId))
      set({ viewId, selection: { elements: [], relations: [] } });
  },

  enterChangeSet(id) {
    const { baseline } = get();
    if (!baseline || !openChangeSet(baseline, id)) return;
    const shown = shownOf(baseline, id);
    set({ changeSetId: id, project: shown, selection: pruneSelection(shown, get().selection) });
  },

  leaveChangeSet() {
    const { baseline } = get();
    if (!baseline) return;
    set({
      changeSetId: null,
      project: baseline,
      selection: pruneSelection(baseline, get().selection),
    });
  },

  patchSilently(patch) {
    const { project, baseline, version } = get();
    if (project && baseline)
      set({
        project: { ...project, ...patch },
        baseline: { ...baseline, ...patch },
        version: version + 1,
      });
  },

  replace(project) {
    const changeSetId = openChangeSet(project, get().changeSetId);
    set({
      project: shownOf(project, changeSetId),
      baseline: project,
      changeSetId,
      past: [],
      future: [],
      selection: { elements: [], relations: [] },
      version: get().version + 1,
    });
  },

  applyRemote(ops, revision) {
    const { baseline, changeSetId, version } = get();
    if (!baseline) return false;
    const result = applyOps(baseline, ops, catalog);
    if (!result.ok) return false;
    const saved = { ...result.project, revision };
    const stillOpen = openChangeSet(saved, changeSetId);
    const shown = shownOf(saved, stillOpen);
    // Undo steps stay: they are ID-based and are checked again when used.
    set({
      project: shown,
      baseline: saved,
      changeSetId: stillOpen,
      version: version + 1,
      selection: pruneSelection(shown, get().selection),
    });
    return true;
  },

  replaceRemote(project) {
    const { viewId, version } = get();
    const changeSetId = openChangeSet(project, get().changeSetId);
    const shown = shownOf(project, changeSetId);
    set({
      project: shown,
      baseline: project,
      changeSetId,
      viewId: project.views.some((v) => v.id === viewId)
        ? viewId
        : (project.views[0]?.id ?? 'main'),
      past: [],
      future: [],
      selection: pruneSelection(shown, get().selection),
      version: version + 1,
    });
  },

  markSaved(revision, updatedAt) {
    const { project, baseline } = get();
    if (project && baseline)
      set({
        project: { ...project, revision, updatedAt },
        baseline: { ...baseline, revision, updatedAt },
      });
  },
}));

function pruneSelection(p: Project, s: Selection): Selection {
  const elements = s.elements.filter((id) => p.model.elements.some((e) => e.id === id));
  const relations = s.relations.filter((id) => p.model.relations.some((r) => r.id === id));
  return elements.length === s.elements.length && relations.length === s.relations.length
    ? s
    : { elements, relations };
}
