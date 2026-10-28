import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { draftTour, uniqueId } from '@archguide/core';
import type { Audience, Tour, TourStep } from '@archguide/core';
import { canvasApi, dispatch } from '../actions';
import { catalog, docs } from '../lib/catalog';
import { elementById } from '../lib/model';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { MentionMarkdown, MentionTextarea } from './Notes';
import { inputClass } from './PropertyForm';

const AUDIENCES: Audience[] = ['any', 'beginner', 'intermediate', 'senior', 'agent'];

/** Starts a tour at its first step. */
export function playTour(id: string): void {
  useUi.getState().set({ tour: { id, step: 0 }, dialog: null });
}

/** Drafts a tour from the diagram (§17.8), saves it, and opens it in the editor. */
export function draftAndEditTour(): void {
  const p = useProject.getState().project;
  if (!p) return;
  const tour = draftTour(p, catalog);
  if (dispatch([{ op: 'upsertTour', tour }], { label: 'Draft tour' }))
    useUi.getState().set({ editingTour: tour.id, tour: null });
}

/** The card that walks through a tour, highlighting each step on the canvas. */
export function TourPlayer() {
  const project = useProject((s) => s.project);
  const state = useUi((s) => s.tour);
  const tour = project?.tours.find((t) => t.id === state?.id);
  const step = tour?.steps[state?.step ?? 0];

  useEffect(() => {
    if (step?.elementIds.length) setTimeout(() => canvasApi.focus?.(step.elementIds), 30);
  }, [step]);

  if (!tour || !step || !state) return null;
  const go = (i: number) => useUi.getState().set({ tour: { id: tour.id, step: i } });
  const last = state.step === tour.steps.length - 1;
  return (
    <div
      className="absolute bottom-16 left-1/2 z-30 w-[min(32rem,92%)] -translate-x-1/2 rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] p-3 shadow-xl"
      role="dialog"
      aria-label="Tour"
      data-testid="tour-player"
    >
      <div className="mb-1 flex items-center gap-2 text-xs text-[var(--ag-muted)]">
        <span className="flex-1 truncate">{tour.title}</span>
        <span>
          Step {state.step + 1} of {tour.steps.length}
        </span>
        <button
          type="button"
          aria-label="End the tour"
          className="rounded p-0.5 hover:bg-[var(--ag-panel-2)]"
          onClick={() => useUi.getState().set({ tour: null })}
        >
          <X size={14} />
        </button>
      </div>
      <h3 className="font-semibold">{step.title}</h3>
      <MentionMarkdown text={step.body} />
      {step.conceptIds && step.conceptIds.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 text-xs">
          <span className="text-[var(--ag-muted)]">Learn more:</span>
          {step.conceptIds.map((id) => (
            <button
              key={id}
              type="button"
              className="text-[var(--ag-accent)] hover:underline"
              onClick={() => useUi.getState().openLearn({ kind: 'doc', id })}
            >
              {docs.get(id)?.title ??
                catalog.concepts.get(id)?.name ??
                catalog.relationTypes.get(id)?.name ??
                id}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className="flex items-center gap-1 rounded border border-[var(--ag-border)] px-2 py-1 text-sm disabled:opacity-40"
          disabled={state.step === 0}
          onClick={() => go(state.step - 1)}
        >
          <ChevronLeft size={14} /> Back
        </button>
        <button
          type="button"
          className="flex items-center gap-1 rounded bg-[var(--ag-accent)] px-2 py-1 text-sm text-[var(--ag-accent-text)]"
          onClick={() => (last ? useUi.getState().set({ tour: null }) : go(state.step + 1))}
        >
          {last ? 'Finish' : 'Next'} {!last && <ChevronRight size={14} />}
        </button>
      </div>
    </div>
  );
}

/**
 * Edits a tour. Not modal: select shapes on the canvas, then "Use selection" on a step.
 */
export function TourEditor() {
  const project = useProject((s) => s.project);
  const tourId = useUi((s) => s.editingTour);
  const saved = project?.tours.find((t) => t.id === tourId);
  const [draft, setDraft] = useState<Tour | undefined>(saved);
  useEffect(() => setDraft(saved), [saved]);
  if (!project || !draft || !saved) return null;

  const close = () => useUi.getState().set({ editingTour: null });
  const setStep = (i: number, patch: Partial<TourStep>) =>
    setDraft({ ...draft, steps: draft.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, by: number) => {
    const steps = [...draft.steps];
    const [s] = steps.splice(i, 1);
    steps.splice(i + by, 0, s!);
    setDraft({ ...draft, steps });
  };
  const addStep = () => {
    const sel = useProject.getState().selection;
    const id = uniqueId('step', new Set(draft.steps.map((s) => s.id)));
    setDraft({
      ...draft,
      steps: [
        ...draft.steps,
        { id, title: 'New step', body: '', elementIds: sel.elements, relationIds: sel.relations },
      ],
    });
  };
  const save = () => {
    if (dispatch([{ op: 'upsertTour', tour: draft }], { label: 'Edit tour' }))
      useUi.getState().toast({ tone: 'success', message: `Saved “${draft.title}”.` });
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <aside
      className="absolute right-3 top-3 z-30 flex max-h-[calc(100%-24px)] w-96 max-w-[calc(100%-24px)] flex-col rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] shadow-xl"
      aria-label="Tour editor"
    >
      <header className="flex items-center gap-2 border-b border-[var(--ag-border)] px-3 py-2">
        <h2 className="flex-1 text-sm font-semibold">Edit tour</h2>
        <button
          type="button"
          aria-label="Close the tour editor"
          className="rounded p-0.5 hover:bg-[var(--ag-panel-2)]"
          onClick={close}
        >
          <X size={14} />
        </button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        <input
          aria-label="Tour title"
          className={inputClass}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <label className="flex items-center gap-2 text-xs">
          For
          <select
            aria-label="Audience"
            className={inputClass}
            value={draft.audience}
            onChange={(e) => setDraft({ ...draft, audience: e.target.value as Audience })}
          >
            {AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <ol className="space-y-3">
          {draft.steps.map((s, i) => (
            <li
              key={s.id}
              className="space-y-1 rounded border border-[var(--ag-border)] p-2"
              data-testid={`tour-step-${i + 1}`}
            >
              <div className="flex items-center gap-1">
                <span className="text-xs text-[var(--ag-muted)]">{i + 1}.</span>
                <input
                  aria-label={`Step ${i + 1} title`}
                  className={inputClass}
                  value={s.title}
                  onChange={(e) => setStep(i, { title: e.target.value })}
                />
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={i === 0}
                  className="disabled:opacity-30"
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={i === draft.steps.length - 1}
                  className="disabled:opacity-30"
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete step ${i + 1}`}
                  disabled={draft.steps.length === 1}
                  className="text-[var(--ag-error)] disabled:opacity-30"
                  onClick={() =>
                    setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <MentionTextarea
                label={`Step ${i + 1} text`}
                value={s.body}
                onChange={(v) => setStep(i, { body: v })}
                rows={3}
              />
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <span className="text-[var(--ag-muted)]">Shows:</span>
                {s.elementIds.map((id) => (
                  <span key={id} className="rounded bg-[var(--ag-panel-2)] px-1">
                    {elementById(project, id)?.name ?? id}
                  </span>
                ))}
                {s.elementIds.length === 0 && (
                  <span className="text-[var(--ag-muted)]">nothing</span>
                )}
                <button
                  type="button"
                  className="ml-auto text-[var(--ag-accent)] hover:underline"
                  onClick={() => {
                    const sel = useProject.getState().selection;
                    setStep(i, { elementIds: sel.elements, relationIds: sel.relations });
                  }}
                >
                  Use selection
                </button>
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-[var(--ag-accent)]"
          onClick={addStep}
        >
          <Plus size={12} /> Add a step (shows the current selection)
        </button>
      </div>
      <footer className="flex gap-2 border-t border-[var(--ag-border)] px-3 py-2">
        <button
          type="button"
          disabled={!dirty}
          className="rounded bg-[var(--ag-accent)] px-3 py-1 text-sm text-[var(--ag-accent-text)] disabled:opacity-40"
          onClick={save}
        >
          Save
        </button>
        <button
          type="button"
          className="rounded border border-[var(--ag-border)] px-3 py-1 text-sm"
          onClick={() => {
            if (dirty) save();
            playTour(draft.id);
          }}
        >
          Play
        </button>
        <button
          type="button"
          className="ml-auto flex items-center gap-1 text-xs text-[var(--ag-error)]"
          onClick={() => {
            if (!window.confirm(`Delete the tour “${draft.title}”?`)) return;
            if (dispatch([{ op: 'removeTour', id: draft.id }], { label: 'Delete tour' })) close();
          }}
        >
          <Trash2 size={12} /> Delete tour
        </button>
      </footer>
    </aside>
  );
}
