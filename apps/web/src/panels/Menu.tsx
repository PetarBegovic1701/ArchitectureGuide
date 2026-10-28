import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface MenuItem {
  label: string;
  run: () => void;
}

/** A small drop-down menu for the top bar. Closes on outside click and Escape. */
export function Menu({
  label,
  icon,
  items,
  align = 'left',
  iconOnly = false,
}: {
  label: string;
  icon?: ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  /** Only the icon on the button (small screens); the label stays its accessible name. */
  iconOnly?: boolean;
}) {
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
  return (
    <div className="relative" ref={ref} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button
        type="button"
        className="ag-touch flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)]"
        aria-haspopup="menu"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {icon} {!iconOnly && label} {!iconOnly && <ChevronDown size={12} aria-hidden />}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full z-40 mt-1 max-h-[70vh] min-w-48 overflow-y-auto rounded border border-[var(--ag-border)] bg-[var(--ag-panel)] py-1 shadow-lg`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="ag-touch block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--ag-panel-2)]"
              onClick={() => {
                setOpen(false);
                item.run();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
