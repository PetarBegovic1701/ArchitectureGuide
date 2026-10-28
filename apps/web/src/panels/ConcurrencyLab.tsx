import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { LAB_CONTROLS, simulateConcurrency } from '@archguide/core';
import type { LabControl, LabStep, LabStepKind } from '@archguide/core';

const KIND_STYLE: Record<LabStepKind, string> = {
  begin: 'border-[var(--ag-border)] bg-[var(--ag-panel)]',
  lock: 'border-violet-400 bg-violet-500/15',
  wait: 'border-dashed border-[var(--ag-border)] bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,var(--ag-panel-2)_6px,var(--ag-panel-2)_12px)]',
  read: 'border-sky-400 bg-sky-500/15',
  compute: 'border-[var(--ag-border)] bg-[var(--ag-panel-2)]',
  write: 'border-amber-400 bg-amber-500/15',
  conflict: 'border-[var(--ag-error)] bg-[color-mix(in_srgb,var(--ag-error)_15%,transparent)]',
  commit: 'border-[var(--ag-valid)] bg-[color-mix(in_srgb,var(--ag-valid)_15%,transparent)]',
  rollback: 'border-[var(--ag-error)] bg-[var(--ag-panel)]',
};

const SLOT = 132;

/**
 * The concurrency lab (Implementation.md §17.7): requests as lanes, steps as cards. Play
 * shows the interleaving; switching the control replays it. With `onApply`, the chosen
 * control can be written back to the `writes` relation the lab was opened from.
 */
export function ConcurrencyLab({
  initialControl = 'none',
  onApply,
  applyLabel,
}: {
  initialControl?: LabControl;
  onApply?: (control: LabControl) => void;
  applyLabel?: string;
}) {
  const [control, setControl] = useState<LabControl>(initialControl);
  const [requests, setRequests] = useState(2);
  const run = useMemo(() => simulateConcurrency(control, { requests }), [control, requests]);
  const [time, setTime] = useState(run.length);
  const [playing, setPlaying] = useState(false);

  // A new scenario starts from the beginning and plays.
  useEffect(() => {
    setTime(0);
    setPlaying(true);
  }, [run]);
  useEffect(() => {
    if (!playing) return;
    if (time >= run.length) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setTime((t) => t + 1), 550);
    return () => window.clearTimeout(timer);
  }, [playing, time, run.length]);

  const done = time >= run.length;
  const visible = (s: LabStep) => s.t < time;
  const stockNow = run.steps.filter((s) => s.t < time).at(-1)?.stock ?? run.initial;
  const spec = LAB_CONTROLS.find((c) => c.id === control)!;
  const button =
    'ag-touch flex items-center gap-1 rounded border border-[var(--ag-border)] px-2 py-1 text-sm disabled:opacity-40';

  return (
    <div className="space-y-3" data-testid="concurrency-lab">
      <p className="text-sm text-[var(--ag-muted)]">
        A product has <strong>{run.initial}</strong> items in stock. {requests} customers buy one
        each, at the same moment, on different API instances. Each request reads the stock,
        subtracts one and writes it back. The stock should end at <strong>{run.expected}</strong>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Concurrency control" className="flex flex-wrap gap-1">
          {LAB_CONTROLS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={control === c.id}
              onClick={() => setControl(c.id)}
              className={`ag-touch rounded border px-2 py-1 text-sm ${control === c.id ? 'border-[var(--ag-accent)] bg-[var(--ag-accent)] text-[var(--ag-accent-text)]' : 'border-[var(--ag-border)]'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1 text-sm">
          Requests
          <select
            className="rounded border border-[var(--ag-border)] bg-[var(--ag-bg)] px-1 py-0.5"
            value={requests}
            onChange={(e) => setRequests(Number(e.target.value))}
          >
            {[2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <code className="block rounded bg-[var(--ag-panel-2)] px-2 py-1 text-xs">{spec.sql}</code>

      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          className={button}
          onClick={() => {
            if (done) setTime(0);
            setPlaying(!playing || done);
          }}
        >
          {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
          {playing ? 'Pause' : done ? 'Replay' : 'Play'}
        </button>
        <button
          type="button"
          className={button}
          aria-label="Step back"
          disabled={time === 0}
          onClick={() => {
            setPlaying(false);
            setTime((t) => Math.max(0, t - 1));
          }}
        >
          <SkipBack size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={button}
          aria-label="Step forward"
          disabled={done}
          onClick={() => {
            setPlaying(false);
            setTime((t) => Math.min(run.length, t + 1));
          }}
        >
          <SkipForward size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={button}
          aria-label="Show the end"
          onClick={() => {
            setPlaying(false);
            setTime(run.length);
          }}
        >
          <RotateCcw size={14} aria-hidden className="-scale-x-100" /> End
        </button>
        <span className="ml-auto text-sm" data-testid="lab-stock">
          Stock in the database: <strong>{stockNow}</strong>
        </span>
      </div>

      {/* The timeline scrolls inside its box on small screens; the page does not. */}
      <div className="overflow-x-auto rounded border border-[var(--ag-border)]">
        <div
          className="relative"
          style={{ width: 96 + run.length * SLOT, height: 28 + run.lanes.length * 64 }}
          role="table"
          aria-label="Timeline"
        >
          {run.lanes.map((lane, i) => (
            <div
              key={lane}
              role="row"
              className="absolute left-0 flex items-center border-b border-[var(--ag-border)] px-2 text-xs font-semibold"
              style={{ top: 28 + i * 64, height: 64, width: '100%' }}
            >
              <span role="rowheader" className="w-20 shrink-0">
                {lane}
              </span>
            </div>
          ))}
          {Array.from({ length: run.length }, (_, t) => (
            <div
              key={t}
              className={`absolute top-0 border-l border-[var(--ag-border)] text-center text-[10px] text-[var(--ag-muted)] ${t < time ? '' : 'opacity-40'}`}
              style={{ left: 96 + t * SLOT, width: SLOT, height: '100%' }}
              aria-hidden
            >
              t{t + 1}
            </div>
          ))}
          {run.steps.map((s, i) => (
            <div
              key={i}
              role="cell"
              data-kind={s.kind}
              className={`absolute flex items-center rounded border px-1.5 text-xs leading-tight transition-opacity ${KIND_STYLE[s.kind]} ${visible(s) ? 'opacity-100' : 'opacity-0'}`}
              style={{
                left: 96 + s.t * SLOT + 4,
                width: s.duration * SLOT - 8,
                top: 28 + s.lane * 64 + 8,
                height: 48,
              }}
              aria-hidden={!visible(s)}
            >
              {s.label}
            </div>
          ))}
        </div>
      </div>

      {done && (
        <div
          role="status"
          data-testid="lab-outcome"
          className={`rounded border p-2 text-sm ${run.lostUpdates > 0 ? 'border-[var(--ag-error)] bg-[color-mix(in_srgb,var(--ag-error)_8%,transparent)]' : 'border-[var(--ag-valid)] bg-[color-mix(in_srgb,var(--ag-valid)_8%,transparent)]'}`}
        >
          <p className="font-semibold">
            Final stock {run.final}, expected {run.expected}
            {run.lostUpdates > 0 ? ` — ${run.lostUpdates} lost` : ' — correct'}
          </p>
          <p>{run.summary}</p>
        </div>
      )}

      {onApply && (
        <button
          type="button"
          className="ag-touch rounded bg-[var(--ag-accent)] px-3 py-1.5 text-sm text-[var(--ag-accent-text)]"
          onClick={() => onApply(control)}
        >
          {applyLabel ?? 'Use this'}: {spec.name}
        </button>
      )}
    </div>
  );
}
