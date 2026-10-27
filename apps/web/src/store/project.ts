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
  },

  select(selection) {
    set({ selection });
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
