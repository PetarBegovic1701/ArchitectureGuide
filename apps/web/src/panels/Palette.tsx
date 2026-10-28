import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { PALETTE_GROUPS } from '@archguide/core';
import type { Concept } from '@archguide/core';
import { catalog } from '../lib/catalog';
import { addElementFromPalette } from '../actions';
import { DRAG_MIME } from '../canvas/Canvas';
import { iconFor } from '../canvas/icons';
import { useUi } from '../store/ui';

function matches(c: Concept, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return [c.name, c.id, ...(c.aliases ?? [])].some((s) => s.toLowerCase().includes(q));
}

/** Concepts to drag (or click) onto the canvas, grouped and searchable (§13.4). */
export function Palette({ variant = 'side' }: { variant?: 'side' | 'sheet' }) {
  const mode = useUi((s) => s.paletteMode);
  const setMode = useUi((s) => s.setPaletteMode);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const concepts = [...catalog.concepts.values()].filter(
      (c) => (mode === 'full' || c.palette.basic || query) && matches(c, query),
    );
    return PALETTE_GROUPS.map((group) => ({
      group,
      items: concepts
        .filter((c) => c.palette.group === group)
        .sort((a, b) => a.palette.order - b.palette.order),
    })).filter((g) => g.items.length > 0);
  }, [mode, query]);

  return (
    <aside
      className={`flex h-full shrink-0 flex-col bg-[var(--ag-panel)] ${variant === 'side' ? 'w-56 border-r border-[var(--ag-border)]' : 'w-full'}`}
      aria-label="Palette"
    >
      <div className="space-y-2 border-b border-[var(--ag-border)] p-2">
        <input
          type="search"
          placeholder="Search shapes (e.g. prisma, queue)"
          aria-label="Search shapes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded border border-[var(--ag-border)] bg-[var(--ag-bg)] px-2 py-1 text-sm outline-none focus:border-[var(--ag-accent)]"
        />
        <div
          className="flex rounded border border-[var(--ag-border)] text-xs"
          role="group"
          aria-label="Palette size"
        >
          {(['basic', 'full'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`flex-1 py-0.5 capitalize ${mode === m ? 'bg-[var(--ag-accent)] text-[var(--ag-accent-text)]' : ''}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {groups.map(({ group, items }) => (
          <section key={group} className="mb-3">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ag-muted)]">
              {group}
            </h3>
            <ul className="space-y-0.5">
              {items.map((c) => {
                const Icon = iconFor(c.icon);
                return (
                  <li key={c.id} className="group/item flex items-center">
                    <button
                      type="button"
                      draggable
                      data-testid={`palette-item-${c.id}`}
                      title={`${c.docs}\nDrag onto the canvas, or click to add.`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_MIME, c.id);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => {
                        addElementFromPalette(c.id);
                        // On a phone the sheet covers the canvas: close it to show the new shape.
                        if (variant === 'sheet') useUi.getState().set({ panel: null });
                      }}
                      className="ag-touch flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-[var(--ag-panel-2)]"
                    >
                      <Icon size={15} className="shrink-0 text-[var(--ag-muted)]" aria-hidden />
                      <span className="truncate">{c.name}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`About ${c.name}`}
                      title="What it is, real-world uses, what it connects to"
                      className="ag-touch shrink-0 rounded p-1 text-[var(--ag-muted)] opacity-60 hover:bg-[var(--ag-panel-2)] hover:text-[var(--ag-accent)] hover:opacity-100 focus-visible:opacity-100 group-hover/item:opacity-100"
                      onClick={() => {
                        useUi.getState().openLearn({ kind: 'doc', id: c.id });
                        // Small screens: show the guide in the inspector drawer or sheet.
                        if (variant === 'sheet') useUi.getState().set({ panel: 'inspector' });
                      }}
                    >
                      <Info size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {groups.length === 0 && (
          <p className="text-sm text-[var(--ag-muted)]">No shape matches “{query}”.</p>
        )}
      </div>
    </aside>
  );
}
