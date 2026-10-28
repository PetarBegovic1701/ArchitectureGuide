import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  BoxSelect,
  GraduationCap,
  Plus,
  SlidersHorizontal,
  Spline,
  X,
} from 'lucide-react';
import { cancelConnectMode, deleteSelection, duplicate, startConnectMode } from '../actions';
import { catalog } from '../lib/catalog';
import { countBySeverity } from '../lib/findings';
import { elementById } from '../lib/model';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { useFindings } from './Problems';

/**
 * Small-screen parts of the editor (Implementation.md §13.10): drawers on tablets,
 * a bottom toolbar and bottom sheets on phones, connect mode, and a context menu.
 */

const close = () => useUi.getState().set({ panel: null });

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Moves focus into the panel, keeps Tab inside it, and closes it on Escape. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      const root = ref.current;
      if (e.key !== 'Tab' || !root?.contains(document.activeElement)) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref, onClose]);
}

/** A panel that slides over the canvas from the left or right (tablets). */
export function Drawer({
  side,
  label,
  children,
}: {
  side: 'left' | 'right';
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, close);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={label}
      className={`absolute bottom-0 top-0 z-40 flex w-80 max-w-[85vw] flex-col bg-[var(--ag-panel)] shadow-2xl outline-none ${side === 'left' ? 'left-0 border-r' : 'right-0 border-l'} border-[var(--ag-border)]`}
    >
      <div className="flex justify-end border-b border-[var(--ag-border)] p-1">
        <button
          type="button"
          className="ag-touch rounded hover:bg-[var(--ag-panel-2)]"
          aria-label={`Close ${label}`}
          onClick={close}
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** A panel that slides up from the bottom (phones). Drag the handle down to close it. */
export function BottomSheet({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  useDismiss(ref, close);
  const move = (dy: number) => {
    if (ref.current) ref.current.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
  };
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={label}
      className="absolute inset-x-0 bottom-0 z-40 flex h-[70%] flex-col rounded-t-2xl border-t border-[var(--ag-border)] bg-[var(--ag-panel)] shadow-2xl outline-none"
      data-testid="bottom-sheet"
    >
      <div
        className="flex shrink-0 cursor-grab touch-none items-center justify-center py-2"
        aria-hidden
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, dy: 0 };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          drag.current.dy = e.clientY - drag.current.y;
          move(drag.current.dy);
        }}
        onPointerUp={() => {
          const dy = drag.current?.dy ?? 0;
          drag.current = null;
          move(0);
          if (dy > 80) close();
        }}
      >
        <span className="h-1.5 w-12 rounded-full bg-[var(--ag-border)]" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function ToolButton({
  label,
  icon,
  active = false,
  onClick,
  badge,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`relative flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? 'text-[var(--ag-accent)]' : 'text-[var(--ag-muted)]'}`}
    >
      {icon}
      {label}
      {badge}
    </button>
  );
}

/** The phone toolbar: add, connect, select several, inspect, learn, problems. */
export function BottomToolbar() {
  const panel = useUi((s) => s.panel);
  const connectMode = useUi((s) => s.connectMode);
  const multiSelect = useUi((s) => s.multiSelect);
  const tab = useUi((s) => s.inspectorTab);
  const counts = countBySeverity(useFindings());
  const open = (p: 'palette' | 'inspector' | 'problems', extra: object = {}) =>
    useUi.getState().set({ panel: panel === p && !('inspectorTab' in extra) ? null : p, ...extra });
  const problems = counts.error + counts.warning;
  return (
    <nav
      className="flex h-14 shrink-0 items-stretch border-t border-[var(--ag-border)] bg-[var(--ag-panel)]"
      aria-label="Toolbar"
    >
      <ToolButton
        label="Add"
        icon={<Plus size={18} />}
        active={panel === 'palette'}
        onClick={() => open('palette')}
      />
      <ToolButton
        label="Connect"
        icon={<Spline size={18} />}
        active={!!connectMode}
        onClick={() => (connectMode ? cancelConnectMode() : startConnectMode())}
      />
      <ToolButton
        label="Select"
        icon={<BoxSelect size={18} />}
        active={multiSelect}
        onClick={() => useUi.getState().set({ multiSelect: !multiSelect })}
      />
      <ToolButton
        label="Inspect"
        icon={<SlidersHorizontal size={18} />}
        active={panel === 'inspector' && tab !== 'learn'}
        onClick={() =>
          panel === 'inspector' && tab !== 'learn'
            ? close()
            : open('inspector', { inspectorTab: 'properties' })
        }
      />
      <ToolButton
        label="Learn"
        icon={<GraduationCap size={18} />}
        active={panel === 'inspector' && tab === 'learn'}
        onClick={() =>
          panel === 'inspector' && tab === 'learn'
            ? close()
            : open('inspector', { inspectorTab: 'learn' })
        }
      />
      <ToolButton
        label="Problems"
        icon={<AlertTriangle size={18} />}
        active={panel === 'problems'}
        onClick={() => open('problems')}
        badge={
          problems > 0 && (
            <span
              className="absolute right-2 top-1 rounded-full px-1 text-[10px] font-bold text-white"
              style={{ background: counts.error ? 'var(--ag-error)' : 'var(--ag-warning)' }}
              data-testid="toolbar-problem-count"
            >
              {problems}
            </span>
          )
        }
      />
    </nav>
  );
}

/** Shown while connect mode is on: what to tap next, and a way out. */
export function ConnectBanner() {
  const mode = useUi((s) => s.connectMode);
  const project = useProject((s) => s.project);
  if (!mode || !project) return null;
  const source = mode.sourceId ? elementById(project, mode.sourceId) : undefined;
  return (
    <div
      className="absolute left-1/2 top-3 z-30 flex max-w-[92%] -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--ag-accent)] bg-[var(--ag-panel)] px-3 py-1.5 text-sm shadow"
      role="status"
      data-testid="connect-banner"
    >
      <Spline size={14} className="shrink-0 text-[var(--ag-accent)]" aria-hidden />
      <span>
        {source ? (
          <>
            From <strong>{source.name}</strong>: tap the shape to connect to.
          </>
        ) : (
          'Tap the shape to connect from.'
        )}
      </span>
      <button
        type="button"
        className="ag-touch rounded-full text-[var(--ag-accent)]"
        onClick={cancelConnectMode}
      >
        Cancel
      </button>
    </div>
  );
}

/** Actions for one shape or arrow, opened by a long-press or a right-click. */
export function ContextMenu({ smallScreen }: { smallScreen: boolean }) {
  const menu = useUi((s) => s.contextMenu);
  const project = useProject((s) => s.project);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    ref.current?.querySelector('button')?.focus();
    const dismiss = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof PointerEvent && ref.current?.contains(e.target as Node)) return;
      useUi.getState().set({ contextMenu: null });
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, [menu]);
  if (!menu || !project) return null;

  const ui = useUi.getState();
  const isElement = menu.kind === 'element';
  const element = isElement ? elementById(project, menu.id) : undefined;
  const relation = !isElement ? project.model.relations.find((r) => r.id === menu.id) : undefined;
  if (!element && !relation) return null;
  const select = () =>
    useProject
      .getState()
      .select(
        isElement ? { elements: [menu.id], relations: [] } : { elements: [], relations: [menu.id] },
      );
  const inspect = (tab: 'properties' | 'learn') => {
    select();
    ui.set({
      inspectorTab: tab,
      ...(tab === 'learn' ? { learnTarget: { kind: 'selection' as const } } : {}),
      ...(smallScreen ? { panel: 'inspector' as const } : {}),
    });
  };
  const items: { label: string; run: () => void; danger?: boolean }[] = [
    ...(element
      ? [
          { label: 'Rename', run: () => ui.set({ editingId: menu.id }) },
          { label: 'Connect from here', run: () => startConnectMode(menu.id) },
        ]
      : []),
    { label: 'Inspect', run: () => inspect('properties') },
    {
      label: element
        ? `What is a ${(catalog.concepts.get(element.kind)?.name ?? element.kind).toLowerCase()}?`
        : `What does “${catalog.relationTypes.get(relation!.type)?.name ?? relation!.type}” mean?`,
      run: () => inspect('learn'),
    },
    ...(element ? [{ label: 'Duplicate', run: () => (select(), duplicate()) }] : []),
    { label: 'Delete', run: () => (select(), deleteSelection()), danger: true },
  ];
  // Keep the menu on screen.
  const x = Math.min(menu.x, window.innerWidth - 230);
  const y = Math.min(menu.y, window.innerHeight - items.length * 44 - 16);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${element?.name ?? relation!.type}`}
      className="fixed z-50 w-56 rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] py-1 shadow-xl"
      style={{ left: Math.max(8, x), top: Math.max(8, y) }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`block min-h-11 w-full px-3 text-left text-sm hover:bg-[var(--ag-panel-2)] ${item.danger ? 'text-[var(--ag-error)]' : ''}`}
          onClick={() => {
            useUi.getState().set({ contextMenu: null });
            item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
