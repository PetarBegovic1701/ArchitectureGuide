import { useState } from 'react';
import { X } from 'lucide-react';
import type { SnapshotRef } from '@archguide/core';
import { compareWith, createSnapshot, removeSnapshot, restoreSnapshot } from '../lib/snapshots';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

const button =
  'rounded border border-[var(--ag-border)] px-2 py-0.5 text-xs hover:bg-[var(--ag-panel-2)] disabled:opacity-40';

/** Named copies of the project: create, compare with the canvas, restore, delete (§14.4). */
export function SnapshotsDialog({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useUi((s) => s.toast);
  if (!project) return null;
  const refs = [...project.snapshots].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast({ tone: 'error', message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const ref = await createSnapshot(project, name);
      useProject.getState().patchSilently({ snapshots: [...project.snapshots, ref] });
      setName('');
      toast({ tone: 'success', message: `Saved the snapshot “${ref.name}”.` });
    });

  const compare = (ref: SnapshotRef) =>
    run(async () => {
      useUi.getState().set({ compare: await compareWith(project, ref) });
      onClose();
    });

  const restore = (ref: SnapshotRef) =>
    run(async () => {
      if (
        !window.confirm(
          `Restore “${ref.name}”? The current state is saved as a snapshot first, so you can come back to it.`,
        )
      )
        return;
      useProject.getState().replace(await restoreSnapshot(project, ref));
      useUi.getState().set({ compare: null });
      toast({ tone: 'success', message: `Restored “${ref.name}”.` });
      onClose();
    });

  const remove = (ref: SnapshotRef) =>
    run(async () => {
      if (!window.confirm(`Delete the snapshot “${ref.name}”?`)) return;
      useProject.getState().patchSilently({ snapshots: await removeSnapshot(project, ref.id) });
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Snapshots"
        className="w-[32rem] space-y-3 rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] p-4 shadow-xl"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <header className="flex items-center">
          <h2 className="flex-1 font-semibold">Snapshots</h2>
          <button
            type="button"
            className="rounded p-1 hover:bg-[var(--ag-panel-2)]"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <p className="text-sm text-[var(--ag-muted)]">
          A snapshot is a named copy of the whole project. Compare one with the canvas to see what
          changed since then, or go back to it.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            aria-label="Snapshot name"
            className="flex-1 rounded border border-[var(--ag-border)] bg-[var(--ag-bg)] px-2 py-1 text-sm outline-none focus:border-[var(--ag-accent)]"
            placeholder={`e.g. Before payments (revision ${project.revision})`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-[var(--ag-accent)] px-3 py-1 text-sm text-[var(--ag-accent-text)] disabled:opacity-40"
          >
            Save snapshot
          </button>
        </form>
        {refs.length === 0 ? (
          <p className="text-sm text-[var(--ag-muted)]">No snapshots yet.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-[var(--ag-border)] overflow-y-auto rounded border border-[var(--ag-border)]">
            {refs.map((ref) => (
              <li
                key={ref.id}
                className="flex items-center gap-2 px-3 py-2 text-sm"
                data-testid={`snapshot-${ref.name}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{ref.name}</span>
                  <span className="text-xs text-[var(--ag-muted)]">
                    {new Date(ref.createdAt).toLocaleString()} · revision {ref.revision}
                  </span>
                </span>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => compare(ref)}
                >
                  Compare
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => restore(ref)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className={`${button} text-[var(--ag-error)]`}
                  disabled={busy}
                  onClick={() => remove(ref)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Banner over the canvas while it is compared with a snapshot. */
export function CompareBanner() {
  const compare = useUi((s) => s.compare);
  if (!compare) return null;
  const removed = compare.removed;
  return (
    <div
      className="absolute left-1/2 top-3 z-20 max-w-[90%] -translate-x-1/2 rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] px-3 py-2 text-sm shadow"
      role="status"
      data-testid="compare-banner"
    >
      <div className="flex items-center gap-3">
        <span>
          Compared with <strong>{compare.snapshotName}</strong>:
        </span>
        <span style={{ color: 'var(--ag-valid)' }}>{compare.added.size} new</span>
        <span style={{ color: 'var(--ag-warning)' }}>{compare.changed.size} changed</span>
        <span style={{ color: 'var(--ag-error)' }}>{removed.length} removed</span>
        <button
          type="button"
          className="ml-2 rounded p-0.5 hover:bg-[var(--ag-panel-2)]"
          aria-label="Stop comparing"
          onClick={() => useUi.getState().set({ compare: null })}
        >
          <X size={14} />
        </button>
      </div>
      {removed.length > 0 && (
        <p className="mt-1 text-xs text-[var(--ag-muted)]">
          Removed: {removed.map((r) => r.name).join(', ')}
        </p>
      )}
    </div>
  );
}
