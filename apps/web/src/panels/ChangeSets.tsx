import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, GitMerge, Trash2, X } from 'lucide-react';
import { describeChanges } from '@archguide/core';
import type { ChangeSet, Id, Task } from '@archguide/core';
import {
  applyToBaseline,
  dropConflicts,
  introducedFindings,
  mergeWithPrevious,
  moveTask,
  opText,
  rebase,
  regenerateTasks,
  removeChangeSet,
  setTasks,
  startChangeSet,
  stateOf,
  updateChangeSet,
  useActiveChangeSet,
  useOverlay,
} from '../lib/changesets';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

const field =
  'rounded border border-[var(--ag-border)] bg-[var(--ag-bg)] px-1.5 py-1 text-sm outline-none focus:border-[var(--ag-accent)]';
const button =
  'rounded border border-[var(--ag-border)] px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)] disabled:opacity-40';
const primary =
  'rounded bg-[var(--ag-accent)] px-2 py-1 text-xs text-[var(--ag-accent-text)] disabled:opacity-40';

const STATUS_LABEL: Record<ChangeSet['status'], string> = {
  draft: 'Draft',
  ready: 'Ready (plan exported)',
  implemented: 'Implemented',
  abandoned: 'Abandoned',
};

const open = (cs: ChangeSet) => cs.status === 'draft' || cs.status === 'ready';

const exportPlan = () =>
  useUi.getState().set({ dialog: 'export', exportFormat: 'plan-md', panel: null });

/** "Editing change set: …" over the canvas while edits go into a change set (§16.1). */
export function ChangeSetBanner() {
  const cs = useActiveChangeSet();
  const overlay = useOverlay();
  const baseline = useProject((s) => s.baseline);
  const conflicts = useMemo(
    () => (cs && baseline ? stateOf(baseline, cs).conflicts.length : 0),
    [cs, baseline],
  );
  if (!cs || !overlay) return null;
  return (
    <div
      className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs"
      style={{
        background: 'color-mix(in srgb, var(--ag-domain) 18%, var(--ag-panel))',
        borderColor: 'var(--ag-domain)',
      }}
      role="status"
      data-testid="changeset-banner"
    >
      <span className="font-semibold">
        Editing change set: <span data-testid="changeset-name">{cs.name}</span>
      </span>
      <span style={{ color: 'var(--ag-valid)' }}>{overlay.added.size} new</span>
      <span style={{ color: 'var(--ag-warning)' }}>{overlay.changed.size} changed</span>
      <span style={{ color: 'var(--ag-error)' }}>{overlay.removed.size} removed</span>
      {conflicts > 0 && (
        <span className="font-semibold" style={{ color: 'var(--ag-error)' }}>
          {conflicts} conflict(s) with the baseline
        </span>
      )}
      <span className="ml-auto flex gap-1">
        <button
          type="button"
          className={button}
          onClick={() => useUi.getState().set({ dialog: 'changesets', panel: null })}
        >
          Tasks and details…
        </button>
        <button type="button" className={button} onClick={exportPlan}>
          Export plan
        </button>
        <button
          type="button"
          className={button}
          onClick={() => useProject.getState().leaveChangeSet()}
          data-testid="leave-changeset"
        >
          Back to baseline
        </button>
      </span>
    </div>
  );
}

/** Change sets: start one, edit on the canvas, tasks, conflicts, export, apply (§16). */
export function ChangeSetsDialog({ onClose }: { onClose: () => void }) {
  const baseline = useProject((s) => s.baseline)!;
  const active = useProject((s) => s.changeSetId);
  const [selected, setSelected] = useState<Id | null>(
    active ?? baseline.changeSets.find(open)?.id ?? baseline.changeSets[0]?.id ?? null,
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const cs = baseline.changeSets.find((c) => c.id === selected);

  const start = () => {
    const id = startChangeSet(name, description);
    if (!id) return;
    setName('');
    setDescription('');
    setSelected(id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 max-sm:p-0"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Change sets"
        className="flex h-[min(760px,92vh)] w-[min(1080px,96vw)] overflow-hidden rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] shadow-2xl max-sm:h-dvh max-sm:w-screen max-sm:flex-col max-sm:rounded-none"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <nav
          className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-r border-[var(--ag-border)] p-2 max-sm:max-h-[40%] max-sm:w-full max-sm:border-b max-sm:border-r-0"
          aria-label="Change sets"
        >
          <form
            className="flex flex-col gap-1 rounded border border-[var(--ag-border)] p-2"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <span className="text-xs font-semibold">Plan a feature</span>
            <input
              className={field}
              placeholder="Name, e.g. Add payments"
              aria-label="Change set name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <textarea
              className={field}
              rows={2}
              placeholder="What the feature does"
              aria-label="Change set description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <button type="submit" className={primary} disabled={!name.trim()}>
              Start change set
            </button>
          </form>
          <ul className="flex flex-col gap-0.5">
            {baseline.changeSets.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`w-full rounded px-2 py-1.5 text-left ${c.id === selected ? 'bg-[var(--ag-panel-2)]' : 'hover:bg-[var(--ag-panel-2)]'}`}
                  onClick={() => setSelected(c.id)}
                >
                  <span className="block text-sm font-medium">
                    {c.name}
                    {c.id === active && ' ✎'}
                  </span>
                  <span className="block text-xs text-[var(--ag-muted)]">
                    {STATUS_LABEL[c.status]} · {c.ops.length} change(s)
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {baseline.changeSets.length === 0 && (
            <p className="text-xs text-[var(--ag-muted)]">
              A change set is a feature proposal on top of the current model (the baseline). While
              it is open, your edits go into it; the canvas shows what it adds, changes and removes,
              and the Problems panel the findings it introduces. Export the plan for an agent or a
              reviewer, then apply it once it is built.
            </p>
          )}
        </nav>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-[var(--ag-border)] px-3 py-2">
            <h2 className="flex-1 font-semibold">{cs ? cs.name : 'Change sets'}</h2>
            <button
              type="button"
              className="rounded p-1 hover:bg-[var(--ag-panel-2)]"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </header>
          {cs ? (
            <Detail key={cs.id} cs={cs} active={cs.id === active} onClose={onClose} />
          ) : (
            <p className="p-3 text-sm text-[var(--ag-muted)]">Start a change set on the left.</p>
          )}
        </section>
      </div>
    </div>
  );
}

type Tab = 'changes' | 'tasks' | 'conflicts' | 'findings';

function Detail({ cs, active, onClose }: { cs: ChangeSet; active: boolean; onClose: () => void }) {
  const baseline = useProject((s) => s.baseline)!;
  const state = useMemo(() => stateOf(baseline, cs), [baseline, cs]);
  const rows = useMemo(() => describeChanges(baseline, state.effective), [baseline, state]);
  const findings = useMemo(
    () => introducedFindings(baseline, state.effective).filter((f) => !f.suppressed),
    [baseline, state],
  );
  const [tab, setTab] = useState<Tab>(state.conflicts.length ? 'conflicts' : 'changes');
  const editable = open(cs);
  const tabs: [Tab, string][] = [
    ['changes', `Changes (${rows.length})`],
    ['tasks', `Tasks (${cs.tasks?.length ?? 0})`],
    ['conflicts', `Conflicts (${state.conflicts.length})`],
    ['findings', `New findings (${findings.length})`],
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-[var(--ag-border)] p-3">
        <textarea
          className={field}
          rows={2}
          aria-label="Description"
          defaultValue={cs.description}
          disabled={!editable}
          onBlur={(e) =>
            e.target.value !== cs.description &&
            updateChangeSet(cs.id, { description: e.target.value }, 'Describe change set')
          }
        />
        <div className="flex flex-wrap items-center gap-1">
          <label className="flex items-center gap-1 text-xs">
            Status
            <select
              className={field}
              aria-label="Status"
              value={cs.status}
              onChange={(e) => {
                const status = e.target.value as ChangeSet['status'];
                if (status === 'implemented') applyToBaseline(cs.id);
                else updateChangeSet(cs.id, { status }, `Mark ${status}`);
              }}
            >
              {(Object.keys(STATUS_LABEL) as ChangeSet['status'][]).map((s) => (
                <option key={s} value={s} disabled={s === 'implemented' && !editable}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          {editable &&
            (active ? (
              <button
                type="button"
                className={button}
                onClick={() => useProject.getState().leaveChangeSet()}
              >
                Back to baseline
              </button>
            ) : (
              <button
                type="button"
                className={primary}
                onClick={() => {
                  useProject.getState().enterChangeSet(cs.id);
                  onClose();
                }}
                data-testid="edit-changeset"
              >
                Edit on the canvas
              </button>
            ))}
          <button
            type="button"
            className={button}
            onClick={() => {
              if (!active && editable) useProject.getState().enterChangeSet(cs.id);
              exportPlan();
            }}
          >
            Export plan…
          </button>
          {editable && (
            <button
              type="button"
              className={button}
              disabled={state.conflicts.length > 0}
              title={
                state.conflicts.length
                  ? 'Fix the conflicts first'
                  : 'Merge the changes into the baseline and mark the change set implemented'
              }
              onClick={() => applyToBaseline(cs.id)}
              data-testid="apply-changeset"
            >
              Apply to baseline
            </button>
          )}
          <button
            type="button"
            className={`${button} ml-auto`}
            onClick={() => removeChangeSet(cs.id)}
            aria-label="Delete change set"
          >
            <Trash2 size={12} aria-hidden />
          </button>
        </div>
        {state.stale && (
          <p className="text-xs text-[var(--ag-muted)]">
            The baseline changed since this change set was started.{' '}
            <button type="button" className="underline" onClick={() => rebase(cs.id)}>
              Rebase
            </button>{' '}
            to check it against the current model.
          </p>
        )}
      </div>
      <div role="tablist" className="flex gap-1 border-b border-[var(--ag-border)] px-2">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`px-2 py-1.5 text-xs ${tab === id ? 'border-b-2 border-[var(--ag-accent)] font-semibold' : 'text-[var(--ag-muted)]'}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
        {tab === 'changes' && (
          <>
            {rows.length === 0 && (
              <p className="text-[var(--ag-muted)]">
                No changes yet. Edit on the canvas: what you add, change or delete goes into this
                change set.
              </p>
            )}
            <table className="w-full text-xs">
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.op}-${r.id}`} className="border-b border-[var(--ag-border)]">
                    <td
                      className="py-1 pr-2 font-semibold"
                      style={{
                        color:
                          r.op === 'ADD'
                            ? 'var(--ag-valid)'
                            : r.op === 'CHANGE'
                              ? 'var(--ag-warning)'
                              : 'var(--ag-error)',
                      }}
                    >
                      {r.op}
                    </td>
                    <td className="py-1 pr-2 font-mono">{r.item}</td>
                    <td className="py-1 text-[var(--ag-muted)]">{r.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cs.ops.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-[var(--ag-muted)]">
                  All {cs.ops.length} recorded edits
                </summary>
                <ol className="mt-1 list-decimal pl-5 text-xs">
                  {cs.ops.map((op, i) => (
                    <li key={i}>{opText(op, state.effective)}</li>
                  ))}
                </ol>
              </details>
            )}
          </>
        )}
        {tab === 'tasks' && <Tasks cs={cs} editable={editable} />}
        {tab === 'conflicts' && (
          <>
            {state.conflicts.length === 0 ? (
              <p className="text-[var(--ag-muted)]">Every change still applies to the baseline.</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-[var(--ag-muted)]">
                  These edits no longer apply: the baseline changed under them. Drop them, or change
                  the baseline back, then rebase.
                </p>
                <ul className="flex flex-col gap-1" data-testid="conflicts">
                  {state.conflicts.map((c) => (
                    <li key={c.index} className="flex items-center gap-2 text-xs">
                      <span className="flex-1">
                        <strong>{opText(c.op, baseline)}</strong>: {c.message}
                      </span>
                      <button
                        type="button"
                        className={button}
                        onClick={() => dropConflicts(cs.id, [c.index])}
                      >
                        Drop
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-1">
                  <button
                    type="button"
                    className={button}
                    onClick={() =>
                      dropConflicts(
                        cs.id,
                        state.conflicts.map((c) => c.index),
                      )
                    }
                  >
                    Drop all
                  </button>
                  <button type="button" className={button} onClick={() => rebase(cs.id)}>
                    Rebase
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {tab === 'findings' && (
          <ul className="flex flex-col gap-1">
            {findings.length === 0 && (
              <li className="text-[var(--ag-muted)]">This change introduces no findings.</li>
            )}
            {findings.map((f) => (
              <li key={`${f.ruleId}:${f.targetIds.join()}`} className="text-xs">
                <strong>
                  {f.severity} · {f.ruleId}
                </strong>{' '}
                {f.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tasks({ cs, editable }: { cs: ChangeSet; editable: boolean }) {
  const tasks = cs.tasks ?? [];
  const update = (t: Task, patch: Partial<Task>) =>
    setTasks(
      cs.id,
      tasks.map((x) => (x.id === t.id ? { ...x, ...patch } : x)),
    );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={primary}
          disabled={!editable || cs.ops.length === 0}
          onClick={() => regenerateTasks(cs.id)}
          data-testid="generate-tasks"
        >
          {tasks.length ? 'Regenerate tasks' : 'Generate tasks'}
        </button>
        <span className="text-xs text-[var(--ag-muted)]">
          In build order: data first, then ports, domain, adapters, use cases, handlers, services,
          BFF and frontend. Ticked tasks stay ticked.
        </span>
      </div>
      <ol className="flex flex-col gap-1" data-testid="tasks">
        {tasks.map((t, i) => (
          <li key={t.id} className="rounded border border-[var(--ag-border)] p-2">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={t.done}
                aria-label={`Done: ${t.title}`}
                onChange={(e) => update(t, { done: e.target.checked })}
              />
              <span className="mt-0.5 w-5 text-xs text-[var(--ag-muted)]">{i + 1}.</span>
              <input
                className={`${field} flex-1 font-medium ${t.done ? 'line-through' : ''}`}
                aria-label="Task title"
                defaultValue={t.title}
                disabled={!editable}
                onBlur={(e) =>
                  e.target.value.trim() &&
                  e.target.value !== t.title &&
                  update(t, { title: e.target.value.trim() })
                }
              />
              <div className="flex shrink-0">
                <IconButton
                  label="Move up"
                  onClick={() => moveTask(cs.id, t.id, -1)}
                  disabled={!editable || i === 0}
                >
                  <ArrowUp size={12} />
                </IconButton>
                <IconButton
                  label="Move down"
                  onClick={() => moveTask(cs.id, t.id, 1)}
                  disabled={!editable || i === tasks.length - 1}
                >
                  <ArrowDown size={12} />
                </IconButton>
                <IconButton
                  label="Merge with the task above"
                  onClick={() => mergeWithPrevious(cs.id, t.id)}
                  disabled={!editable || i === 0}
                >
                  <GitMerge size={12} />
                </IconButton>
                <IconButton
                  label="Delete task"
                  onClick={() =>
                    setTasks(
                      cs.id,
                      tasks
                        .filter((x) => x.id !== t.id)
                        .map((x) => ({ ...x, dependsOn: x.dependsOn.filter((d) => d !== t.id) })),
                    )
                  }
                  disabled={!editable}
                >
                  <Trash2 size={12} />
                </IconButton>
              </div>
            </div>
            {t.detail && (
              <pre className="mt-1 whitespace-pre-wrap pl-12 font-sans text-xs text-[var(--ag-muted)]">
                {t.detail}
              </pre>
            )}
            {t.dependsOn.length > 0 && (
              <p className="mt-1 pl-12 text-[11px] text-[var(--ag-muted)]">
                After:{' '}
                {t.dependsOn
                  .map((d) => tasks.findIndex((x) => x.id === d) + 1)
                  .filter((n) => n > 0)
                  .join(', ')}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="rounded p-1 hover:bg-[var(--ag-panel-2)] disabled:opacity-30"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
