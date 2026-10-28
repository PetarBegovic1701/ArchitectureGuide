import { useEffect, useRef, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ChevronDown,
  Lightbulb,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { RULE_PACKS } from '@archguide/core';
import type { Finding, Id, Level, Project, Severity } from '@archguide/core';
import {
  SEVERITIES,
  SEVERITY_COLOR,
  countBySeverity,
  findingKey,
  findingsOf,
  introducedKeys,
  severityLabel,
} from '../lib/findings';
import { catalog } from '../lib/catalog';
import { elementById } from '../lib/model';
import {
  applyQuickFix,
  focusFinding,
  setRulePack,
  suppressFinding,
  unsuppressFinding,
} from '../actions';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

const ICONS: Record<Severity, typeof AlertOctagon> = {
  error: AlertOctagon,
  warning: AlertTriangle,
  info: Lightbulb,
};

export function useFindings(): Finding[] {
  const project = useProject((s) => s.project);
  return project ? findingsOf(project) : [];
}

/** "Orders API", or "Web app → calls → Orders API" for a relation. */
export function itemName(p: Project, id: Id): string {
  const el = elementById(p, id);
  if (el) return el.name;
  const r = p.model.relations.find((x) => x.id === id);
  if (!r) return id;
  const type = catalog.relationTypes.get(r.type)?.name ?? r.type;
  return `${elementById(p, r.sourceId)?.name ?? r.sourceId} ${type} ${elementById(p, r.targetId)?.name ?? r.targetId}`;
}

/** Top-bar button with open-finding counts; toggles the Problems panel. */
export function ProblemsButton() {
  const findings = useFindings();
  const open = useUi((s) => s.problemsOpen);
  const level = useUi((s) => s.level);
  const counts = countBySeverity(findings);
  const summary = SEVERITIES.map(
    (s) => `${counts[s]} ${severityLabel(s, level).toLowerCase()}`,
  ).join(', ');
  return (
    <button
      type="button"
      className={`flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)] ${open ? 'bg-[var(--ag-panel-2)]' : ''}`}
      onClick={() => useUi.getState().set({ problemsOpen: !open })}
      aria-pressed={open}
      aria-label={`Problems: ${summary}`}
      title="Problems panel"
      data-testid="problems-toggle"
    >
      {SEVERITIES.map((s) => {
        const Icon = ICONS[s];
        return (
          <span
            key={s}
            className="inline-flex items-center gap-0.5"
            data-testid={`count-${s}`}
            style={{ color: counts[s] ? SEVERITY_COLOR[s] : 'var(--ag-muted)' }}
          >
            <Icon size={13} aria-hidden />
            {counts[s]}
          </span>
        );
      })}
    </button>
  );
}

/** Bottom panel: findings grouped by severity (Implementation.md §13.4). */
export function ProblemsPanel({ variant = 'side' }: { variant?: 'side' | 'sheet' }) {
  const project = useProject((s) => s.project);
  const open = useUi((s) => s.problemsOpen);
  const level = useUi((s) => s.level);
  const showSuppressed = useUi((s) => s.showSuppressed);
  const showAll = useUi((s) => s.showAllFindings);
  const changeSetId = useProject((s) => s.changeSetId);
  const baseline = useProject((s) => s.baseline);
  const findings = useFindings();
  if ((!open && variant === 'side') || !project) return null;
  // Change-set mode: by default only what the change introduces (§16.1).
  const introduced = changeSetId && baseline ? introducedKeys(baseline, project) : null;
  const visible = findings.filter(
    (f) =>
      (showSuppressed || !f.suppressed) &&
      (!introduced || showAll || introduced.has(findingKey(f))),
  );
  const suppressedCount = findings.filter((f) => f.suppressed).length;

  return (
    <section
      className={`flex shrink-0 flex-col bg-[var(--ag-panel)] ${variant === 'side' ? 'h-56 border-t border-[var(--ag-border)]' : 'h-full'}`}
      aria-label="Problems"
      data-testid="problems-panel"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--ag-border)] px-3 py-1.5 text-sm">
        <h2 className="font-semibold">Problems</h2>
        <span className="text-xs text-[var(--ag-muted)]">
          {level === 'beginner'
            ? 'Things that often go wrong in designs like this one. Click one to see where it is.'
            : `${visible.length} shown`}
        </span>
        {introduced && (
          <label className="ml-auto flex items-center gap-1 text-xs text-[var(--ag-muted)]">
            <input
              type="checkbox"
              checked={!showAll}
              onChange={(e) => useUi.getState().set({ showAllFindings: !e.target.checked })}
              data-testid="only-new-findings"
            />
            Only new in this change ({introduced.size})
          </label>
        )}
        <label
          className={`${introduced ? '' : 'ml-auto '}flex items-center gap-1 text-xs text-[var(--ag-muted)]`}
        >
          <input
            type="checkbox"
            checked={showSuppressed}
            onChange={(e) => useUi.getState().set({ showSuppressed: e.target.checked })}
          />
          Show suppressed ({suppressedCount})
        </label>
        <RulePacksMenu project={project} />
        <button
          type="button"
          className="rounded p-1 hover:bg-[var(--ag-panel-2)]"
          aria-label="Close the Problems panel"
          onClick={() =>
            useUi.getState().set(variant === 'side' ? { problemsOpen: false } : { panel: null })
          }
        >
          <X size={14} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {visible.length === 0 ? (
          <p className="text-sm text-[var(--ag-muted)]" data-testid="no-problems">
            {introduced && !showAll
              ? 'This change introduces no problems.'
              : 'No problems found by the active rules.'}
          </p>
        ) : (
          SEVERITIES.map((severity) => {
            const group = visible.filter((f) => f.severity === severity);
            if (group.length === 0) return null;
            return (
              <details
                key={severity}
                // Seniors see info findings collapsed; everything else starts open.
                open={!(severity === 'info' && level === 'senior')}
                className="mb-2"
              >
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--ag-muted)]">
                  {severityLabel(severity, level)} ({group.length})
                </summary>
                <ul className="mt-1 space-y-1">
                  {group.map((f) => (
                    <li key={findingKey(f)}>
                      <FindingRow finding={f} project={project} level={level} />
                    </li>
                  ))}
                </ul>
              </details>
            );
          })
        )}
      </div>
    </section>
  );
}

/** One finding: what and where, quick fixes, "Why?", and suppress. */
export function FindingRow({
  finding: f,
  project,
  level,
  compact = false,
}: {
  finding: Finding;
  project: Project;
  level: Level;
  compact?: boolean;
}) {
  const active = useUi((s) => s.activeFinding === findingKey(f));
  const Icon = ICONS[f.severity];
  const where = f.targetIds.map((id) => itemName(project, id)).join(', ');
  const button =
    'rounded border border-[var(--ag-border)] px-1.5 py-0.5 text-xs hover:bg-[var(--ag-panel-2)]';
  return (
    <div
      className={`rounded border p-2 text-sm ${active ? 'border-[var(--ag-accent)]' : 'border-transparent hover:border-[var(--ag-border)]'} ${f.suppressed ? 'opacity-60' : ''}`}
      data-testid={`finding-${f.ruleId}`}
    >
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left"
        onClick={() => focusFinding(f)}
        aria-label={`${severityLabel(f.severity, level, false)} ${f.ruleId}: ${f.title}. Show on the canvas.`}
      >
        <Icon
          size={15}
          className="mt-0.5 shrink-0"
          style={{ color: SEVERITY_COLOR[f.severity] }}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="font-semibold">{f.title}</span>{' '}
          {level !== 'beginner' && (
            <span className="text-xs text-[var(--ag-muted)]">{f.ruleId}</span>
          )}
          {!compact && <span className="block text-xs text-[var(--ag-muted)]">{where}</span>}
          <span className="block">{f.message}</span>
          {f.suppressed && (
            <span className="block text-xs italic text-[var(--ag-muted)]">
              Suppressed: {f.suppressed.reason}
            </span>
          )}
        </span>
      </button>
      <div className="mt-1 flex flex-wrap gap-1 pl-6">
        {!f.suppressed &&
          f.fixes.map((fix) => (
            <button
              key={fix.title}
              type="button"
              className={`${button} border-[var(--ag-accent)] text-[var(--ag-accent)]`}
              onClick={() => applyQuickFix(f, fix)}
            >
              {fix.title}
            </button>
          ))}
        <button
          type="button"
          className={button}
          onClick={() => useUi.getState().openLearn({ kind: 'rule', id: f.ruleId })}
        >
          Why?
        </button>
        {f.suppressed ? (
          <button type="button" className={button} onClick={() => unsuppressFinding(f)}>
            Unsuppress
          </button>
        ) : (
          <button
            type="button"
            className={button}
            onClick={() => useUi.getState().set({ suppressing: f })}
          >
            Suppress…
          </button>
        )}
      </div>
    </div>
  );
}

/** Turns rule packs on and off for the project. */
function RulePacksMenu({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const active = new Set(project.settings.rulePacks);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-[var(--ag-panel-2)]"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal size={13} aria-hidden /> Rules <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div
          className="absolute bottom-full right-0 z-30 mb-1 w-72 rounded border border-[var(--ag-border)] bg-[var(--ag-panel)] p-2 shadow-lg"
          role="group"
          aria-label="Rule packs"
        >
          {RULE_PACKS.map((pack) => {
            const always = pack.id === 'core';
            return (
              <label key={pack.id} className="flex items-start gap-2 py-1 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={always || active.has(pack.id)}
                  disabled={always}
                  onChange={(e) => setRulePack(pack.id, e.target.checked)}
                />
                <span>
                  <span className="font-medium">{pack.name}</span>
                  <span className="block text-xs text-[var(--ag-muted)]">{pack.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Asks why a finding does not apply. A reason is required, so suppressions stay reviewable. */
export function SuppressDialog() {
  const finding = useUi((s) => s.suppressing);
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [finding]);
  if (!finding) return null;
  const close = () => useUi.getState().set({ suppressing: null });
  const valid = reason.trim().length >= 10;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Suppress finding"
        className="max-h-[90dvh] w-[min(28rem,calc(100vw-2rem))] space-y-3 overflow-y-auto rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] p-4 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          suppressFinding(finding, reason);
          close();
        }}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <h2 className="font-semibold">Suppress “{finding.title}”</h2>
        <p className="text-sm text-[var(--ag-muted)]">
          Say why this does not apply here. The reason is saved with the project and shows in
          exports, so reviewers and agents know it was a decision.
        </p>
        <textarea
          autoFocus
          aria-label="Reason"
          className="h-24 w-full rounded border border-[var(--ag-border)] bg-transparent p-2 text-sm outline-none focus:border-[var(--ag-accent)]"
          value={reason}
          placeholder="e.g. Internal admin tool, only reachable through the VPN."
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex items-center justify-end gap-2">
          {!valid && (
            <span className="mr-auto text-xs text-[var(--ag-muted)]">At least 10 characters.</span>
          )}
          <button type="button" className="rounded px-3 py-1 text-sm" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="rounded bg-[var(--ag-accent)] px-3 py-1 text-sm text-[var(--ag-accent-text)] disabled:opacity-40"
          >
            Suppress
          </button>
        </div>
      </form>
    </div>
  );
}
