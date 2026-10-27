import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { ShapeFlowNode } from '../lib/flow';
import { CONTAINER_HEADER } from '../lib/model';
import { renameElement } from '../actions';
import { useUi } from '../store/ui';
import { iconFor } from './icons';
import { LABEL_BELOW, ShapeSvg } from './shapes';

/** Box-like shapes show the icon in the top-left corner; other shapes show it above the label. */
const ICON_CORNER: ReadonlySet<string> = new Set([
  'rect',
  'rounded',
  'window',
  'plug',
  'gear',
  'document',
]);

const SIDES = [
  { id: 't', position: Position.Top },
  { id: 'r', position: Position.Right },
  { id: 'b', position: Position.Bottom },
  { id: 'l', position: Position.Left },
];

/** One element on the canvas: its shape, icon, label and four connection handles. */
function ShapeNodeImpl({ data, selected }: NodeProps<ShapeFlowNode>) {
  const Icon = iconFor(data.icon);
  const below = !data.container && LABEL_BELOW.has(data.shape);
  const dashed = data.status === 'planned' && !data.container;

  return (
    <div
      className="relative"
      style={{ width: data.w, height: data.h }}
      data-testid={`node-${data.elementId}`}
      title={`${data.name} — ${data.conceptName}`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        useUi.getState().set({ editingId: data.elementId });
      }}
    >
      <ShapeSvg
        shape={data.shape}
        w={data.w}
        h={data.h}
        color={data.color}
        selected={selected}
        dashed={dashed}
        muted={data.container}
      />
      {data.container ? (
        <div
          className="ag-container-header absolute left-0 right-0 top-0 flex items-center gap-1.5 rounded-t-lg px-2"
          style={{ height: CONTAINER_HEADER }}
        >
          <Icon size={14} style={{ color: data.color }} aria-hidden />
          <Label data={data} className="truncate text-xs font-semibold" />
          <span className="ml-auto truncate text-[10px] text-[var(--ag-muted)]">
            {data.conceptName}
          </span>
        </div>
      ) : (
        <>
          {ICON_CORNER.has(data.shape) && (
            <Icon
              size={14}
              className="absolute left-2"
              style={{ color: data.color, top: data.shape === 'window' ? 20 : 8 }}
              aria-hidden
            />
          )}
          <div
            className={
              below
                ? 'absolute left-1/2 top-full mt-1 w-40 -translate-x-1/2 text-center'
                : 'absolute inset-0 flex flex-col items-center justify-center px-3 text-center'
            }
            style={data.shape === 'window' && !below ? { top: 16 } : undefined}
          >
            {!ICON_CORNER.has(data.shape) && !below && (
              <Icon
                size={13}
                className="mb-0.5 shrink-0"
                style={{ color: data.color }}
                aria-hidden
              />
            )}
            <Label data={data} className="line-clamp-2 text-[13px] font-semibold leading-tight" />
            <span className="mt-0.5 truncate text-[10px] text-[var(--ag-muted)]">
              {data.conceptName}
            </span>
          </div>
        </>
      )}
      {SIDES.map((s) => (
        <Handle key={s.id} id={s.id} type="source" position={s.position} className="ag-handle" />
      ))}
    </div>
  );
}

function Label({ data, className }: { data: ShapeFlowNode['data']; className: string }) {
  if (data.editing) return <NameInput id={data.elementId} initial={data.name} />;
  return <span className={className}>{data.name}</span>;
}

/** Inline rename. Enter or blur saves, Escape cancels. */
function NameInput({ id, initial }: { id: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) renameElement(id, value);
    else useUi.getState().set({ editingId: null });
  };
  return (
    <input
      ref={ref}
      aria-label="Element name"
      className="nodrag nopan w-full min-w-0 rounded border border-[var(--ag-accent)] bg-[var(--ag-panel)] px-1 text-center text-[13px] font-semibold outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}

export const ShapeNode = memo(ShapeNodeImpl);
