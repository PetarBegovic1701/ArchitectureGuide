import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Layer } from '@archguide/core';
import { catalog, defaultLayer } from '../lib/catalog';
import { LAYERS, layerColor } from '../lib/model';
import {
  addElementFromPalette,
  alignSelection,
  canvasApi,
  createRelation,
  deleteSelection,
  distributeSelection,
  duplicate,
  exportJson,
  redo,
  tidyUp,
  undo,
} from '../actions';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

/** Toasts with actions such as "Reverse it" and "Why?" (§10.4). */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  useEffect(() => {
    const timers = toasts.map((t) =>
      setTimeout(() => dismiss(t.id), t.tone === 'error' ? 12000 : 5000),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(560px,90vw)] -translate-x-1/2 flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          data-testid="toast"
          className="pointer-events-auto flex items-start gap-2 rounded-lg border bg-[var(--ag-panel)] p-3 text-sm shadow-lg"
          style={{
            borderColor:
              t.tone === 'error'
                ? 'var(--ag-error)'
                : t.tone === 'success'
                  ? 'var(--ag-valid)'
                  : 'var(--ag-border)',
          }}
        >
          <p className="flex-1">{t.message}</p>
          {t.actions?.map((a) => (
            <button
              key={a.label}
              type="button"
              className="shrink-0 rounded border border-[var(--ag-border)] px-2 py-0.5 text-xs font-semibold hover:bg-[var(--ag-panel-2)]"
              onClick={() => {
                a.run();
                dismiss(t.id);
              }}
            >
              {a.label}
            </button>
          ))}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-[var(--ag-muted)]"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Choose the relation type when more than one is valid (§10.5). Enter picks the first. */
export function RelationPicker() {
  const picker = useUi((s) => s.picker);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picker) return;
    ref.current?.querySelector('button')?.focus();
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && useUi.getState().set({ picker: null });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker]);
  if (!picker) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Choose a relation type"
      data-testid="relation-picker"
      className="fixed z-50 w-64 rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] p-1 shadow-xl"
      style={{
        left: Math.min(picker.x, window.innerWidth - 270),
        top: Math.min(picker.y, window.innerHeight - 260),
      }}
    >
      <p className="px-2 py-1 text-xs text-[var(--ag-muted)]">How are they related?</p>
      {picker.types.map((t) => (
        <button
          key={t.id}
          type="button"
          data-testid={`pick-${t.id}`}
          className="block w-full rounded px-2 py-1 text-left hover:bg-[var(--ag-panel-2)] focus:bg-[var(--ag-panel-2)] focus:outline-none"
          onClick={() => createRelation(picker.sourceId, picker.targetId, t.id)}
        >
          <span className="text-sm font-semibold">{t.name}</span>
          <span className="block text-xs text-[var(--ag-muted)]">{t.docs.split('. ')[0]}</span>
        </button>
      ))}
    </div>
  );
}

interface Command {
  id: string;
  label: string;
  run: () => void;
}

/** Ctrl/Cmd+K: every action by name, including "Add <concept>" and "Go to <element>" (§13.5). */
export function CommandPalette() {
  const open = useUi((s) => s.commandOpen);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const project = useProject((s) => s.project);
  const close = () => useUi.getState().set({ commandOpen: false });

  const commands = useMemo<Command[]>(() => {
    const ui = useUi.getState();
    const list: Command[] = [
      { id: 'undo', label: 'Undo', run: undo },
      { id: 'redo', label: 'Redo', run: redo },
      { id: 'delete', label: 'Delete selection', run: deleteSelection },
      { id: 'duplicate', label: 'Duplicate selection', run: duplicate },
      ...(['beginner', 'intermediate', 'senior'] as const).map((l) => ({
        id: `level-${l}`,
        label: `Level: ${l}`,
        run: () => ui.setLevel(l),
      })),
      { id: 'palette-basic', label: 'Palette: basic', run: () => ui.setPaletteMode('basic') },
      { id: 'palette-full', label: 'Palette: full', run: () => ui.setPaletteMode('full') },
      ...(['system', 'light', 'dark'] as const).map((t) => ({
        id: `theme-${t}`,
        label: `Theme: ${t}`,
        run: () => ui.setTheme(t),
      })),
      ...(project ? [{ id: 'export', label: 'Export JSON', run: () => exportJson(project) }] : []),
      { id: 'templates', label: 'Insert template…', run: () => ui.set({ dialog: 'templates' }) },
      { id: 'snapshots', label: 'Snapshots…', run: () => ui.set({ dialog: 'snapshots' }) },
      { id: 'tidy', label: 'Tidy up (automatic layout)', run: () => void tidyUp() },
      ...(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((how) => ({
        id: `align-${how}`,
        label: `Align ${how}`,
        run: () => alignSelection(how),
      })),
      ...(['horizontal', 'vertical'] as const).map((how) => ({
        id: `distribute-${how}`,
        label: `Distribute ${how}ly`,
        run: () => distributeSelection(how),
      })),
      {
        id: 'save-template',
        label: 'Save selection as template…',
        run: () => ui.set({ dialog: 'save-template' }),
      },
      ...[...catalog.concepts.values()].map((c) => ({
        id: `add-${c.id}`,
        label: `Add ${c.name}`,
        run: () => void addElementFromPalette(c.id),
      })),
      ...(project?.model.elements ?? []).map((e) => ({
        id: `go-${e.id}`,
        label: `Go to ${e.name} (${e.id})`,
        run: () => {
          useProject.getState().select({ elements: [e.id], relations: [] });
          canvasApi.focus?.([e.id]);
        },
      })),
    ];
    return list;
  }, [project]);

  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands
      .filter((c) => words.every((w) => c.label.toLowerCase().includes(w)))
      .slice(0, 12);
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  if (!open) return null;
  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    c.run();
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onClick={close}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-[min(520px,92vw)] overflow-hidden rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          aria-label="Command"
          placeholder="Type a command: add service, undo, level senior …"
          className="w-full border-b border-[var(--ag-border)] bg-transparent px-3 py-2 outline-none"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, filtered.length - 1));
            if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
            if (e.key === 'Enter') run(filtered[index]);
          }}
        />
        <ul role="listbox" className="max-h-80 overflow-y-auto py-1">
          {filtered.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === index}>
              <button
                type="button"
                className={`block w-full px-3 py-1.5 text-left text-sm ${i === index ? 'bg-[var(--ag-panel-2)]' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => run(c)}
              >
                {c.label}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-[var(--ag-muted)]">No command matches.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

/** Which color means which layer, for the layers used in the view (§9.3). */
export function Legend() {
  const project = useProject((s) => s.project);
  const layers = useMemo(() => {
    const used = new Set<Layer>();
    for (const el of project?.model.elements ?? []) {
      if (el.color) continue;
      const layer = el.layer ?? defaultLayer(el.kind);
      if (layer) used.add(layer);
    }
    return LAYERS.filter((l) => used.has(l));
  }, [project]);
  if (layers.length === 0) return null;
  return (
    <div
      className="pointer-events-none absolute bottom-3 left-14 z-10 rounded border border-[var(--ag-border)] bg-[var(--ag-panel)] px-2 py-1 text-[11px]"
      aria-label="Legend"
    >
      {layers.map((l) => (
        <span key={l} className="mr-3 inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: layerColor(l) }}
          />
          {l}
        </span>
      ))}
    </div>
  );
}
