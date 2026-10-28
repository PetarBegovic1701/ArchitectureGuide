import { create } from 'zustand';
import {
  applyOps,
  layOutChangeOps,
  matchModel,
  relationSubject,
  selectSuggestions,
} from '@archguide/core';
import type { AnalysisDiff, AnalysisResult, Evidence, Id, Project } from '@archguide/core';
import { catalog, conceptOf } from './catalog';
import { isServed, loadServeAnalysis, rejectServeSubjects } from '../persistence/serve';
import { dispatch } from '../actions';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

/** One suggestion of the analysis review panel (Implementation.md §19.9). */
export interface Suggestion {
  /** Element or relation ID the suggestion adds (or updates). */
  id: Id;
  type: 'element' | 'relation' | 'update';
  title: string;
  detail: string;
  /** Detector of the first evidence: the group in the panel. */
  detector: string;
  confidence: number;
  evidence: Evidence[];
  /** Fact subject, remembered in rejected.json when the user rejects it. */
  subject?: string;
}

interface AnalysisState {
  result: AnalysisResult | null;
  /** Suggestions rejected in this browser session (serve mode also stores them in the workspace). */
  rejected: Set<Id>;
  loading: boolean;
  load(): Promise<void>;
  setResult(result: AnalysisResult | null): void;
  reject(suggestions: Suggestion[]): Promise<void>;
}

export const useAnalysis = create<AnalysisState>((set, get) => ({
  result: null,
  rejected: new Set(),
  loading: false,
  async load() {
    set({ loading: true });
    const result = (await loadServeAnalysis()) ?? null;
    set({ result, loading: false });
  },
  setResult(result) {
    set({ result, rejected: new Set() });
  },
  async reject(list) {
    set({ rejected: new Set([...get().rejected, ...list.map((s) => s.id)]) });
    const subjects = list.flatMap((s) => (s.subject ? [s.subject] : []));
    const id = useProject.getState().project?.id;
    if (subjects.length && isServed(id)) await rejectServeSubjects(subjects);
  },
}));

/** Reads an analysis file (last.json) chosen by the user. */
export async function readAnalysisFile(file: File): Promise<AnalysisResult> {
  const json = JSON.parse(await file.text()) as AnalysisResult;
  if (!json?.candidates?.elements || !Array.isArray(json.facts))
    throw new Error('This is not an ArchitectureGuide analysis (last.json).');
  return json;
}

/** The candidates against the current model: what is new, changed or gone. */
export function diffFor(project: Project, result: AnalysisResult): AnalysisDiff {
  return matchModel(project.model, result.candidates, {
    detectableKinds: new Set(result.candidates.elements.map((e) => e.kind)),
  });
}

/** The panel's rows: one per suggested op, with what it is, why, and the evidence. */
export function suggestionsOf(
  diff: AnalysisDiff,
  result: AnalysisResult,
  project: Project,
): Suggestion[] {
  const subjectOf = new Map(Object.entries(result.subjects).map(([s, id]) => [id, s]));
  const nameOf = (id: Id) =>
    project.model.elements.find((e) => e.id === id)?.name ??
    diff.suggestedOps.flatMap((o) =>
      o.op === 'addElement' && o.element.id === id ? [o.element.name] : [],
    )[0] ??
    id;
  const out: Suggestion[] = [];
  for (const op of diff.suggestedOps) {
    if (op.op === 'addElement') {
      const e = op.element;
      out.push({
        id: e.id,
        type: 'element',
        title: e.name,
        detail: `${conceptOf(e.kind)?.name ?? e.kind}${e.parentId ? ` in ${nameOf(e.parentId)}` : ''}`,
        detector: e.source?.evidence?.[0]?.detector ?? 'analysis',
        confidence: e.source?.confidence ?? 1,
        evidence: e.source?.evidence ?? [],
        ...(subjectOf.get(e.id) ? { subject: subjectOf.get(e.id)! } : {}),
      });
    } else if (op.op === 'addRelation') {
      const r = op.relation;
      const candidate = result.candidates.relations.find((c) => c.id === r.id);
      const [from, to] = candidate
        ? [subjectOf.get(candidate.sourceId), subjectOf.get(candidate.targetId)]
        : [];
      out.push({
        id: r.id,
        type: 'relation',
        title: `${nameOf(r.sourceId)} ${r.type} ${nameOf(r.targetId)}`,
        detail:
          [r.label, r.via, r.inTransaction ? 'in a transaction' : undefined]
            .filter(Boolean)
            .join(' · ') || 'relation',
        detector: 'relations',
        confidence: r.source?.confidence ?? 1,
        evidence: r.source?.evidence ?? [],
        ...(from && to ? { subject: relationSubject(r.type, from, to) } : {}),
      });
    } else if (op.op === 'updateElement') {
      out.push({
        id: op.id,
        type: 'update',
        title: nameOf(op.id),
        detail: `code paths: ${((op.patch as { codePaths?: string[] }).codePaths ?? []).join(', ')}`,
        detector: 'code paths',
        confidence: 1,
        evidence: [],
      });
    }
  }
  return out;
}

/** What else must come with these: the new ends of relations, and the new parents of elements. */
function closure(diff: AnalysisDiff, ids: readonly Id[], rejected: ReadonlySet<Id>): Id[] {
  const added = new Map(
    diff.suggestedOps.flatMap((o) =>
      o.op === 'addElement' ? [[o.element.id, o.element] as const] : [],
    ),
  );
  const out = new Set(ids);
  for (const op of diff.suggestedOps)
    if (op.op === 'addRelation' && out.has(op.relation.id))
      for (const end of [op.relation.sourceId, op.relation.targetId])
        if (added.has(end) && !rejected.has(end)) out.add(end);
  for (const id of [...out])
    for (
      let p = added.get(id)?.parentId;
      p && added.has(p) && !rejected.has(p);
      p = added.get(p)?.parentId
    )
      out.add(p);
  // Never bring back what the user rejected; children of a rejected parent stay out too.
  return [...out].filter((id) => !rejected.has(id));
}

/** Accepts suggestions as one undo step, marked reviewed, and shows the new shapes. */
export function acceptSuggestions(
  diff: AnalysisDiff,
  ids: readonly Id[] | 'all',
  minConfidence = 0,
): number {
  const { project: p, viewId } = useProject.getState();
  if (!p) return 0;
  const ops = selectSuggestions(diff, {
    accept: closure(
      diff,
      ids === 'all'
        ? diff.suggestedOps.flatMap((o) =>
            o.op === 'addElement'
              ? [o.element.id]
              : o.op === 'addRelation'
                ? [o.relation.id]
                : o.op === 'updateElement'
                  ? [o.id]
                  : [],
          )
        : ids,
      useAnalysis.getState().rejected,
    ),
    minConfidence,
    reviewed: true,
  });
  if (!ops.length) return 0;
  const trial = applyOps(p, ops, catalog);
  if (!trial.ok) {
    useUi
      .getState()
      .toast({ tone: 'error', message: trial.errors[0]?.message ?? 'Could not apply.' });
    return 0;
  }
  const added = new Set(ops.flatMap((o) => (o.op === 'addElement' ? [o.element.id] : [])));
  const placed = layOutChangeOps(p, trial.project, catalog, viewId, added);
  return dispatch([...ops, ...placed], { label: `Accept ${ops.length} suggestion(s)` })
    ? ops.length
    : 0;
}

/** `vscode://file/…` link to the evidence, when the analysis knows the repository folder. */
export const evidenceHref = (result: AnalysisResult, e: Evidence) =>
  e.path.startsWith('postgres://')
    ? undefined
    : `vscode://file/${result.repoRoot.replace(/\/$/, '')}/${e.path}${e.line ? `:${e.line}` : ''}`;
