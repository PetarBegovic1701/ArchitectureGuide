import { useMemo, useState } from 'react';
import {
  BookText,
  ChevronRight,
  Filter,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react';
import { endpointsOf, hasDocs, viewBreadcrumbs } from '@archguide/core';
import type { Id, Project, View } from '@archguide/core';
import { catalog } from '../lib/catalog';
import { activeView, elementById } from '../lib/model';
import { filterChoices, hasFilters } from '../lib/focus';
import { dispatch } from '../actions';
import { useProject } from '../store/project';
import { NO_FILTERS, useUi } from '../store/ui';
import type { CanvasFilters } from '../store/ui';

const chip =
  'pointer-events-auto flex items-center gap-1 rounded border border-[var(--ag-border)] bg-[var(--ag-panel)] px-2 py-1 text-xs shadow-sm';
const button = 'rounded px-1.5 py-0.5 hover:bg-[var(--ag-panel-2)] disabled:opacity-40';

const KIND_LABEL: Record<View['kind'], string> = {
  free: 'Free view',
  context: 'Context',
  container: 'Containers',
  component: 'Components',
  database: 'Database',
  scenario: 'Scenario',
};

/**
 * Top-left of the canvas: where this view sits (first view › drill-down path › this
 * view), and the focus and filter chips (§13.5, §13.8).
 */
export function CanvasChips() {
  const project = useProject((s) => s.project);
  const viewId = useProject((s) => s.viewId);
  const inChangeSet = useProject((s) => Boolean(s.changeSetId));
  const focusDepth = useUi((s) => s.focusDepth);
  const filters = useUi((s) => s.filters);
  if (!project) return null;
  const crumbs = viewBreadcrumbs(project, viewId);
  const view = activeView(project, viewId);
  const showCrumbs = project.views.length > 1;
  if (!showCrumbs && !focusDepth && !hasFilters(filters)) return null;
  return (
    <div
      className={`pointer-events-none absolute left-2 z-10 flex flex-wrap items-center gap-1 ${inChangeSet ? 'top-10' : 'top-2'}`}
    >
      {showCrumbs && (
        <nav aria-label="Breadcrumbs" className={chip} data-testid="breadcrumbs">
          {crumbs.map((v, i) => (
            <span key={v.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} aria-hidden />}
              {v.id === view.id ? (
                <span className="font-semibold" aria-current="page">
                  {v.name}
                </span>
              ) : (
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => useProject.getState().setView(v.id)}
                >
                  {v.name}
                </button>
              )}
            </span>
          ))}
          <span className="text-[var(--ag-muted)]">· {KIND_LABEL[view.kind]}</span>
        </nav>
      )}
      {focusDepth && (
        <span className={chip} data-testid="focus-chip">
          Focus · depth
          {([1, 2, 3] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={focusDepth === d}
              className={`${button} ${focusDepth === d ? 'bg-[var(--ag-accent)] text-[var(--ag-accent-text)]' : ''}`}
              onClick={() => useUi.getState().set({ focusDepth: d })}
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            className={button}
            aria-label="Leave focus mode"
            title="Leave focus mode (F)"
            onClick={() => useUi.getState().set({ focusDepth: null })}
          >
            <X size={12} />
          </button>
        </span>
      )}
      {hasFilters(filters) && (
        <span className={chip} data-testid="filter-chip">
          <Filter size={12} aria-hidden />
          {describeFilters(filters)}
          <button
            type="button"
            className={button}
            aria-label="Clear filters"
            onClick={() => useUi.getState().set({ filters: NO_FILTERS })}
          >
            <X size={12} />
          </button>
        </span>
      )}
    </div>
  );
}

function describeFilters(f: CanvasFilters): string {
  return [
    f.tags.length ? `tags ${f.tags.join(', ')}` : '',
    f.layers.length ? `layers ${f.layers.join(', ')}` : '',
    f.statuses.length ? `status ${f.statuses.join(', ')}` : '',
    f.owners.length ? `owner ${f.owners.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const FILTER_GROUPS: [keyof CanvasFilters, string][] = [
  ['tags', 'Tags'],
  ['layers', 'Layers'],
  ['statuses', 'Status'],
  ['owners', 'Owner'],
];

/** Top-bar "Filter" button: dim shapes by tag, layer, status or owner (§13.5). */
export function FiltersButton() {
  const project = useProject((s) => s.project);
  const filters = useUi((s) => s.filters);
  const [open, setOpen] = useState(false);
  const choices = useMemo(() => (project ? filterChoices(project) : NO_FILTERS), [project]);
  const toggle = (group: keyof CanvasFilters, value: string) => {
    const list = filters[group];
    useUi.getState().set({
      filters: {
        ...filters,
        [group]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
      },
    });
  };
  return (
    <div className="relative">
      <button
        type="button"
        className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)] ${hasFilters(filters) ? 'bg-[var(--ag-panel-2)]' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Filter: dim shapes by tag, layer, status or owner"
      >
        <Filter size={14} aria-hidden /> <span className="max-2xl:sr-only">Filter</span>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-40 mt-1 flex w-64 flex-col gap-2 rounded border border-[var(--ag-border)] bg-[var(--ag-panel)] p-2 text-xs shadow-lg"
          role="dialog"
          aria-label="Filters"
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        >
          {FILTER_GROUPS.map(([group, label]) => (
            <fieldset key={group}>
              <legend className="mb-0.5 font-semibold">{label}</legend>
              {choices[group].length === 0 && (
                <span className="text-[var(--ag-muted)]">None in this project</span>
              )}
              <div className="flex flex-wrap gap-x-2">
                {choices[group].map((v) => (
                  <label key={v} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={filters[group].includes(v)}
                      onChange={() => toggle(group, v)}
                    />
                    {v}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex justify-between border-t border-[var(--ag-border)] pt-2">
            <button
              type="button"
              className={button}
              onClick={() => useUi.getState().set({ filters: NO_FILTERS })}
            >
              Clear
            </button>
            <button type="button" className={button} onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** True when the project carries documentation of the analyzed repository (§7.2). */
export function projectHasDocs(p: Project | undefined | null): boolean {
  return Boolean(p && (p.docs || p.model.elements.some(hasDocs)));
}

/**
 * Top-bar "Docs" toggle: the repository's documentation (description and function) under the
 * shapes. Only shown when the project has some.
 */
export function DocsButton() {
  const project = useProject((s) => s.project);
  const showDocs = useUi((s) => s.showDocs);
  if (!projectHasDocs(project)) return null;
  const lang = project?.docs?.lang;
  return (
    <button
      type="button"
      className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)] ${showDocs ? 'bg-[var(--ag-panel-2)]' : ''}`}
      aria-pressed={showDocs}
      onClick={() => useUi.getState().set({ showDocs: !showDocs })}
      title={`Documentation: show the repository's description and function of each shape${lang ? ` (written in ${lang})` : ''}`}
    >
      <BookText size={14} aria-hidden /> <span className="max-2xl:sr-only">Docs</span>
    </button>
  );
}

// --- scenarios -------------------------------------------------------------------------

/** One step of a scenario as a sentence: "Web calls Orders API (POST /orders)". */
export function stepText(p: Project, relationId: Id): string {
  const r = p.model.relations.find((x) => x.id === relationId);
  if (!r) return `${relationId} (removed)`;
  const name = (id: Id) => elementById(p, id)?.name ?? id;
  const type = catalog.relationTypes.get(r.type)?.name ?? r.type;
  return `${name(r.sourceId)} ${type} ${name(r.targetId)}${r.label ? ` (${r.label})` : ''}`;
}

const setSteps = (view: View, steps: NonNullable<View['scenario']>['steps'], label: string) =>
  dispatch([{ op: 'updateView', id: view.id, patch: { scenario: { steps } } }], {
    label,
    mergeKey: label === 'Edit step note' ? `note:${view.id}` : undefined,
  });

/** Adds an arrow as the next step of the scenario being recorded. */
export function recordStep(relationId: Id): void {
  const { project, viewId } = useProject.getState();
  if (!project) return;
  const view = activeView(project, viewId);
  if (view.kind !== 'scenario') return;
  const steps = view.scenario?.steps ?? [];
  setSteps(view, [...steps, { relationId }], 'Record step');
}

/**
 * Scenario views: record the steps by clicking arrows in order, add a note per step, and
 * play them back one by one (§13.8). The steps export as a Mermaid sequence diagram.
 */
export function ScenarioBar() {
  const project = useProject((s) => s.project);
  const viewId = useProject((s) => s.viewId);
  const recording = useUi((s) => s.recording);
  const playStep = useUi((s) => s.playStep);
  if (!project) return null;
  const view = activeView(project, viewId);
  if (view.kind !== 'scenario') return null;
  const steps = view.scenario?.steps ?? [];
  const set = useUi.getState().set;
  const play = (i: number | null) => set({ playStep: i, recording: false });
  return (
    <section
      className="absolute bottom-3 left-1/2 z-20 flex max-h-[45%] w-[min(560px,92%)] -translate-x-1/2 flex-col rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] shadow-lg"
      aria-label="Scenario"
      data-testid="scenario-bar"
    >
      <header className="flex items-center gap-1 border-b border-[var(--ag-border)] px-2 py-1 text-xs">
        <strong className="flex-1">{view.name}</strong>
        <button
          type="button"
          className={`${button} ${recording ? 'bg-[var(--ag-error)] text-white' : ''}`}
          aria-pressed={recording}
          onClick={() => set({ recording: !recording, playStep: null })}
          data-testid="record-scenario"
        >
          {recording ? '● Recording: click arrows' : 'Record steps'}
        </button>
        <button
          type="button"
          className={button}
          aria-label="Previous step"
          disabled={!steps.length || playStep === 0}
          onClick={() => play(Math.max(0, (playStep ?? 1) - 1))}
        >
          <SkipBack size={12} />
        </button>
        <button
          type="button"
          className={button}
          aria-label={playStep === null ? 'Play' : 'Stop'}
          disabled={!steps.length}
          onClick={() => play(playStep === null ? 0 : null)}
          data-testid="play-scenario"
        >
          {playStep === null ? <Play size={12} /> : <Pause size={12} />}
        </button>
        <button
          type="button"
          className={button}
          aria-label="Next step"
          disabled={!steps.length || playStep === steps.length - 1}
          onClick={() => play(Math.min(steps.length - 1, (playStep ?? -1) + 1))}
          data-testid="next-step"
        >
          <SkipForward size={12} />
        </button>
        <button
          type="button"
          className={button}
          disabled={!steps.length}
          onClick={() => set({ dialog: 'export', exportFormat: 'sequence' })}
        >
          Sequence diagram
        </button>
      </header>
      <ol className="overflow-y-auto px-2 py-1 text-xs" data-testid="scenario-steps">
        {steps.length === 0 && (
          <li className="py-1 text-[var(--ag-muted)]">
            {recording
              ? 'Click the arrows on the canvas in the order the request travels.'
              : 'No steps yet. Press "Record steps" and click arrows in order.'}
          </li>
        )}
        {steps.map((step, i) => (
          <li
            key={`${i}-${step.relationId}`}
            className={`flex items-center gap-1 rounded px-1 py-0.5 ${playStep === i ? 'bg-[var(--ag-panel-2)] font-semibold' : ''}`}
          >
            <button type="button" className="w-5 text-left" onClick={() => play(i)}>
              {i + 1}.
            </button>
            <span className="min-w-0 flex-1 truncate">{stepText(project, step.relationId)}</span>
            <input
              className="w-40 rounded border border-[var(--ag-border)] bg-[var(--ag-bg)] px-1"
              placeholder="Note"
              aria-label={`Note for step ${i + 1}`}
              defaultValue={step.note ?? ''}
              onBlur={(e) => {
                const note = e.target.value.trim();
                if (note === (step.note ?? '')) return;
                setSteps(
                  view,
                  steps.map((s, k) =>
                    k === i ? { relationId: s.relationId, ...(note ? { note } : {}) } : s,
                  ),
                  'Edit step note',
                );
              }}
            />
            <button
              type="button"
              className={button}
              aria-label={`Remove step ${i + 1}`}
              onClick={() =>
                setSteps(
                  view,
                  steps.filter((_, k) => k !== i),
                  'Remove step',
                )
              }
            >
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

// --- API view --------------------------------------------------------------------------

/**
 * API view (§17.7): the endpoints of the selected route handler or contract, or all of
 * them, with their data shapes, status codes, auth, pagination and idempotency.
 */
export function ApiDialog({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project)!;
  const selection = useProject((s) => s.selection);
  const selected = selection.elements.length === 1 ? selection.elements[0] : undefined;
  const scoped = selected && endpointsOf(project, selected).length > 0 ? selected : undefined;
  const [scope, setScope] = useState<Id | undefined>(scoped);
  const rows = endpointsOf(project, scope);
  const holders = [
    ...new Set(endpointsOf(project).flatMap((r) => (r.parentId ? [r.parentId] : []))),
  ];
  const name = (id?: Id) => (id ? (elementById(project, id)?.name ?? id) : '');
  const open = (id: Id) => {
    useProject.getState().select({ elements: [id], relations: [] });
    onClose();
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 max-sm:p-0"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="API view"
        className="flex max-h-[92vh] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] shadow-2xl max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:rounded-none"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <header className="flex flex-wrap items-center gap-2 border-b border-[var(--ag-border)] px-3 py-2 text-sm">
          <h2 className="font-semibold">API</h2>
          <label className="flex items-center gap-1 text-xs">
            Endpoints of
            <select
              aria-label="Endpoints of"
              className="rounded border border-[var(--ag-border)] bg-[var(--ag-bg)] px-1 py-0.5"
              value={scope ?? ''}
              onChange={(e) => setScope(e.target.value || undefined)}
            >
              <option value="">the whole project</option>
              {holders.map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ml-auto rounded bg-[var(--ag-accent)] px-2 py-1 text-xs text-[var(--ag-accent-text)] disabled:opacity-40"
            disabled={!rows.length}
            onClick={() => {
              if (scope) useProject.getState().select({ elements: [scope], relations: [] });
              useUi.getState().set({ dialog: 'export', exportFormat: 'openapi' });
            }}
          >
            OpenAPI skeleton…
          </button>
          <button
            type="button"
            className="rounded p-1 hover:bg-[var(--ag-panel-2)]"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {rows.length === 0 ? (
            <p className="text-sm text-[var(--ag-muted)]">
              No endpoints yet. Add an “API endpoint” inside a route handler or an API contract,
              with its method and path.
            </p>
          ) : (
            <table className="w-full text-xs" data-testid="endpoints">
              <thead className="text-left text-[var(--ag-muted)]">
                <tr>
                  {[
                    'Method',
                    'Path',
                    'Request',
                    'Response',
                    'Status',
                    'Auth',
                    'Pagination',
                    'Idempotent',
                    'In',
                  ].map((h) => (
                    <th key={h} className="border-b border-[var(--ag-border)] py-1 pr-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--ag-border)]">
                    <td className="py-1 pr-2 font-mono font-semibold">{r.method}</td>
                    <td className="py-1 pr-2 font-mono">
                      <button type="button" className="hover:underline" onClick={() => open(r.id)}>
                        {r.path}
                      </button>
                    </td>
                    {[r.request, r.response].map((dto, i) => (
                      <td key={i} className="py-1 pr-2">
                        {dto ? (
                          <button
                            type="button"
                            className="text-[var(--ag-accent)] hover:underline"
                            onClick={() => open(dto)}
                          >
                            {name(dto)}
                            {i === 1 && r.returnsList ? '[]' : ''}
                          </button>
                        ) : (
                          '–'
                        )}
                      </td>
                    ))}
                    <td className="py-1 pr-2">{r.statusCodes.join(', ')}</td>
                    <td className="py-1 pr-2">
                      {r.auth}
                      {r.roles.length ? ` (${r.roles.join(', ')})` : ''}
                    </td>
                    <td className="py-1 pr-2">{r.pagination}</td>
                    <td className="py-1 pr-2">{r.idempotent ? 'yes' : 'no'}</td>
                    <td className="py-1">{name(r.parentId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
