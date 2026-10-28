import { create } from 'zustand';
import { applyOps } from '@archguide/core';
import type { Id, Op, OpError, Project } from '@archguide/core';
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

interface ProjectState {
  project: Project | null;
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
  /** Records a finished save. Does not count as a change or touch history. */
  markSaved(revision: number, updatedAt: string): void;
  /** Changes data that is not part of the undo history (the snapshot list); saved as usual. */
  patchSilently(patch: Pick<Partial<Project>, 'snapshots'>): void;
  /** Replaces the whole project (restoring a snapshot). History starts over. */
  replace(project: Project): void;
  /** Serve mode: ops from MCP, the CLI or another tab. Not an undo step. */
  applyRemote(ops: Op[], revision: number): boolean;
  /** Serve mode: the server's version replaces this tab's copy; history starts over. */
  replaceRemote(project: Project): void;
}

export const useProject = create<ProjectState>((set, get) => ({
  project: null,
  viewId: 'main',
  past: [],
  future: [],
  selection: { elements: [], relations: [] },
  version: 0,

  load(project) {
    set({
      project,
      viewId: project.views[0]?.id ?? 'main',
      past: [],
      future: [],
      selection: { elements: [], relations: [] },
      version: 0,
    });
  },

  unload() {
    set({ project: null, past: [], future: [], selection: { elements: [], relations: [] } });
  },

  dispatch(ops, meta = {}) {
    const { project, past, version } = get();
    if (!project || ops.length === 0) return [];
    const result = applyOps(project, ops, catalog);
    if (!result.ok) return result.errors;
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
      project: result.project,
      past: nextPast.slice(-HISTORY_LIMIT),
      future: [],
      version: version + 1,
      selection: pruneSelection(result.project, get().selection),
    });
    localChanges?.(ops);
    return [];
  },

  undo() {
    const { project, past, future, version } = get();
    const entry = past[past.length - 1];
    if (!project || !entry) return;
    const result = applyOps(project, entry.inverse, catalog);
    if (!result.ok) return;
    set({
      project: result.project,
      past: past.slice(0, -1),
      future: [...future, { label: entry.label, ops: entry.ops, inverse: entry.inverse }],
      version: version + 1,
      selection: pruneSelection(result.project, get().selection),
    });
    localChanges?.(entry.inverse);
  },

  redo() {
    const { project, past, future, version } = get();
    const entry = future[future.length - 1];
    if (!project || !entry) return;
    const result = applyOps(project, entry.ops, catalog);
    if (!result.ok) return;
    set({
      project: result.project,
      past: [...past, { label: entry.label, ops: entry.ops, inverse: result.inverse }],
      future: future.slice(0, -1),
      version: version + 1,
      selection: pruneSelection(result.project, get().selection),
    });
    localChanges?.(entry.ops);
  },

  select(selection) {
    set({ selection });
  },

  patchSilently(patch) {
    const { project, version } = get();
    if (project) set({ project: { ...project, ...patch }, version: version + 1 });
  },

  replace(project) {
    set({
      project,
      past: [],
      future: [],
      selection: { elements: [], relations: [] },
      version: get().version + 1,
    });
  },

  applyRemote(ops, revision) {
    const { project, version } = get();
    if (!project) return false;
    const result = applyOps(project, ops, catalog);
    if (!result.ok) return false;
    // Undo steps stay: they are ID-based and are checked again when used.
    set({
      project: { ...result.project, revision },
      version: version + 1,
      selection: pruneSelection(result.project, get().selection),
    });
    return true;
  },

  replaceRemote(project) {
    const { viewId, version } = get();
    set({
      project,
      viewId: project.views.some((v) => v.id === viewId)
        ? viewId
        : (project.views[0]?.id ?? 'main'),
      past: [],
      future: [],
      selection: pruneSelection(project, get().selection),
      version: version + 1,
    });
  },

  markSaved(revision, updatedAt) {
    const { project } = get();
    if (project) set({ project: { ...project, revision, updatedAt } });
  },
}));

function pruneSelection(p: Project, s: Selection): Selection {
  const elements = s.elements.filter((id) => p.model.elements.some((e) => e.id === id));
  const relations = s.relations.filter((id) => p.model.relations.some((r) => r.id === id));
  return elements.length === s.elements.length && relations.length === s.relations.length
    ? s
    : { elements, relations };
}
