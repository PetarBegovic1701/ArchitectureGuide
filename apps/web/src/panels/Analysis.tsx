import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { AnalysisResult, Evidence } from '@archguide/core';
import {
  acceptSuggestions,
  diffFor,
  evidenceHref,
  readAnalysisFile,
  suggestionsOf,
  useAnalysis,
} from '../lib/analysis';
import type { Suggestion } from '../lib/analysis';
import { analysisEvents, isServed } from '../persistence/serve';
import { dispatch } from '../actions';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

const button =
  'rounded border border-[var(--ag-border)] px-2 py-0.5 text-xs hover:bg-[var(--ag-panel-2)] disabled:opacity-40';
const primary =
  'rounded bg-[var(--ag-accent)] px-2 py-0.5 text-xs font-semibold text-[var(--ag-accent-text)] disabled:opacity-40';

function EvidenceList({ result, evidence }: { result: AnalysisResult; evidence: Evidence[] }) {
  if (!evidence.length) return null;
  return (
    <ul className="mt-0.5 space-y-0.5 text-[11px] text-[var(--ag-muted)]">
      {evidence.slice(0, 4).map((e) => {
        const label = `${e.path}${e.line ? `:${e.line}` : ''}${e.symbol ? ` (${e.symbol})` : ''}`;
        const href = evidenceHref(result, e);
        return (
          <li key={`${e.path}:${e.line}`} className="truncate">
            {href ? (
              <a
                href={href}
                className="hover:text-[var(--ag-accent)] hover:underline"
                title="Open in the editor"
              >
                {label}
              </a>
            ) : (
              label
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The analysis review panel (Implementation.md §19.9): the analyzer's suggestions grouped by
 * detector, with confidence and evidence. Accept adds them as reviewed; Edit accepts and
 * opens the Inspector; Reject hides them, and in serve mode the next analysis skips them.
 */
export function AnalysisDialog({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project)!;
  const { result, rejected, loading } = useAnalysis();
  const [min, setMin] = useState(0.6);
  const file = useRef<HTMLInputElement>(null);
  const toast = useUi((s) => s.toast);
  const served = isServed(project.id);

  useEffect(() => {
    if (!served) return;
    if (!useAnalysis.getState().result) void useAnalysis.getState().load();
    const reload = () => void useAnalysis.getState().load();
    analysisEvents.addEventListener('change', reload);
    return () => analysisEvents.removeEventListener('change', reload);
  }, [served]);

  const diff = useMemo(() => (result ? diffFor(project, result) : null), [project, result]);
  const rows = useMemo(
    () =>
      diff && result ? suggestionsOf(diff, result, project).filter((s) => !rejected.has(s.id)) : [],
    [diff, result, project, rejected],
  );
  const groups = useMemo(() => {
    const m = new Map<string, Suggestion[]>();
    for (const r of rows) m.set(r.detector, [...(m.get(r.detector) ?? []), r]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const accept = (ids: string[] | 'all', bar = 0) => {
    if (!diff) return 0;
    const n = acceptSuggestions(diff, ids, bar);
    if (n) toast({ tone: 'success', message: `Added ${n} item(s) to the model.` });
    return n;
  };
  const edit = (s: Suggestion) => {
    if (accept([s.id]) && s.type === 'element') {
      useProject.getState().select({ elements: [s.id], relations: [] });
      useUi.getState().set({ inspectorTab: 'properties', dialog: null });
    }
  };

  const missing = diff?.missingInCode ?? [];
  const findings = result?.findings.filter((f) => f.ruleId !== 'DRIFT-001') ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-label="Analysis"
        className="flex max-h-[85vh] w-[min(760px,calc(100vw-2rem))] flex-col rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] shadow-xl"
      >
        <header className="flex items-center gap-2 border-b border-[var(--ag-border)] px-4 py-2">
          <h2 className="font-semibold">Analysis</h2>
          {result && (
            <span className="text-xs text-[var(--ag-muted)]">
              {result.stats.files} files, {result.candidates.elements.length} elements found,{' '}
              {new Date(result.analyzedAt).toLocaleString()}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={button} onClick={() => file.current?.click()}>
              Open last.json…
            </button>
            <button
              type="button"
              aria-label="Close"
              className="rounded p-1 hover:bg-[var(--ag-panel-2)]"
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </div>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="Analysis file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f)
                void readAnalysisFile(f)
                  .then((r) => useAnalysis.getState().setResult(r))
                  .catch((error: Error) => toast({ tone: 'error', message: error.message }));
            }}
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
          {!result ? (
            <p className="text-[var(--ag-muted)]">
              {loading
                ? 'Loading…'
                : 'No analysis yet. Run "npx archguide analyze" in the repository (or the MCP tool analyze_repository), then open its .archguide/analysis/last.json here.'}
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="font-medium">{rows.length} suggestion(s)</span>
                <label className="ml-auto flex items-center gap-1 text-xs text-[var(--ag-muted)]">
                  Confidence at least
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={min}
                    aria-label="Minimum confidence"
                    onChange={(e) => setMin(Number(e.target.value))}
                  />
                  {Math.round(min * 100)}%
                </label>
                <button
                  type="button"
                  className={primary}
                  disabled={!rows.length}
                  onClick={() => accept('all', min)}
                >
                  Accept all
                </button>
              </div>
              {rows.length === 0 && (
                <p className="mb-3 text-[var(--ag-muted)]">
                  The model has everything the analysis found.
                </p>
              )}
              {groups.map(([detector, list]) => (
                <section key={detector} className="mb-3" aria-label={`Detector ${detector}`}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--ag-muted)]">
                    {detector}
                  </h3>
                  <ul className="divide-y divide-[var(--ag-border)] rounded border border-[var(--ag-border)]">
                    {list.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-start gap-2 px-2 py-1.5"
                        data-testid="suggestion"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="truncate font-medium">{s.title}</span>
                            <span className="shrink-0 text-xs text-[var(--ag-muted)]">
                              {s.detail}
                            </span>
                          </div>
                          <EvidenceList result={result} evidence={s.evidence} />
                        </div>
                        <span
                          className="shrink-0 text-xs tabular-nums text-[var(--ag-muted)]"
                          title="Confidence"
                        >
                          {Math.round(s.confidence * 100)}%
                        </span>
                        <button type="button" className={primary} onClick={() => accept([s.id])}>
                          Accept
                        </button>
                        {s.type === 'element' && (
                          <button type="button" className={button} onClick={() => edit(s)}>
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          className={button}
                          onClick={() => void useAnalysis.getState().reject([s])}
                        >
                          Reject
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              {missing.length > 0 && (
                <section className="mb-3" aria-label="Not found in code">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--ag-muted)]">
                    In the model as existing, not found in the code
                  </h3>
                  <ul className="space-y-1">
                    {missing.map((id) => (
                      <li key={id} className="flex items-center gap-2">
                        <span className="flex-1">
                          {project.model.elements.find((e) => e.id === id)?.name ?? id}
                        </span>
                        <button
                          type="button"
                          className={button}
                          onClick={() =>
                            dispatch([{ op: 'updateElement', id, patch: { status: 'planned' } }], {
                              label: 'Mark planned',
                            })
                          }
                        >
                          Mark planned
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {findings.length > 0 && (
                <section aria-label="Findings in the code">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--ag-muted)]">
                    Findings in the code
                  </h3>
                  <ul className="space-y-1.5">
                    {findings.map((f, i) => (
                      <li key={`${f.ruleId}-${i}`} data-testid="analysis-finding">
                        <span className="mr-1 font-semibold">{f.ruleId}</span>
                        {f.message}
                        <EvidenceList result={result} evidence={f.evidence} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {result.warnings.length > 0 && (
                <p className="mt-3 text-xs text-[var(--ag-warning)]">
                  {result.warnings.join(' · ')}
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
