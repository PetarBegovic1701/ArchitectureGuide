import { memo, useEffect, useRef, useState } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import { Cog } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import type { ShapeFlowNode } from '../lib/flow';
import { CONTAINER_HEADER } from '../lib/model';
import { drillInto, renameElement, resizeElement } from '../actions';
import { isPhone } from '../hooks';
import { useUi } from '../store/ui';
import { SEVERITY_COLOR } from '../lib/findings';
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

/** Items marked as anti-patterns found in the code (AP-019). */
export const ANTI_PATTERN_COLOR = 'var(--ag-error)';

export const DIFF_COLOR = {
  added: 'var(--ag-valid)',
  changed: 'var(--ag-warning)',
  removed: 'var(--ag-error)',
} as const;

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
  // While a container is being resized, it is drawn at the size under the pointer.
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);
  const w = live?.w ?? data.w;
  const h = live?.h ?? data.h;

  return (
    <div
      className="relative"
      style={{ width: w, height: h }}
      data-testid={`node-${data.elementId}`}
      title={tooltip(data)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        // On the name: rename. Elsewhere on a deployable or a database: drill down (§13.3).
        const onLabel = (e.target as HTMLElement).closest('[data-role="label"]');
        if (data.ghost) return;
        if (!onLabel && drillInto(data.elementId)) return;
        useUi.getState().set({ editingId: data.elementId });
      }}
    >
      {data.highlighted && (
        <div
          className="ag-halo pointer-events-none absolute -inset-2 rounded-xl"
          style={{ borderColor: SEVERITY_COLOR[data.issue?.severity ?? 'warning'] }}
          aria-hidden
        />
      )}
      {data.container && !data.ghost && (
        <NodeResizer
          isVisible={selected}
          minWidth={data.minW}
          minHeight={data.minH}
          onResize={(_, r) => setLive({ w: r.width, h: r.height })}
          onResizeEnd={(_, r) => {
            setLive(null);
            resizeElement(data.elementId, { x: r.x, y: r.y, w: r.width, h: r.height });
          }}
        />
      )}
      <ShapeSvg
        shape={data.shape}
        w={w}
        h={h}
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
          <Label data={data} className="min-w-0 truncate text-xs font-semibold" />
          {data.showDocs && data.docs?.description && !data.ghost ? (
            // Children start right under the header: a container's documentation goes in it.
            <span
              className="ml-auto min-w-0 shrink-[4] truncate text-[10px] text-[var(--ag-muted)]"
              lang={data.docs.lang}
              dir={data.docs.dir ?? 'auto'}
              data-testid={`docs-${data.elementId}`}
            >
              {data.docs.description}
            </span>
          ) : (
            <span className="ml-auto truncate text-[10px] text-[var(--ag-muted)]">
              {data.conceptName}
            </span>
          )}
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
      {data.showDocs && data.docs && !data.ghost && !data.container && (
        <DocsCard docs={data.docs} id={data.elementId} below={below} />
      )}
      {data.antiPattern && !data.diff && (
        <>
          <div
            className="pointer-events-none absolute -inset-1 rounded-lg border-2 border-dashed"
            style={{ borderColor: ANTI_PATTERN_COLOR }}
            aria-hidden
          />
          <span
            className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded px-1 text-[10px] font-semibold text-white"
            style={{ background: ANTI_PATTERN_COLOR }}
            data-testid={`anti-pattern-${data.elementId}`}
          >
            ⚠ anti-pattern
          </span>
        </>
      )}
      {data.issue && <IssueBadge id={data.elementId} issue={data.issue} />}
      {data.decisionIds && (
        <button
          type="button"
          className="ag-badge nodrag absolute -bottom-2 -left-2 z-10 rounded px-1 text-[9px] font-bold text-white shadow"
          style={{ background: 'var(--ag-domain)' }}
          title={`Decisions: ${data.decisionIds.join(', ')}`}
          aria-label={`${data.decisionIds.length} decision(s): ${data.decisionIds.join(', ')}`}
          data-testid={`adr-${data.elementId}`}
          onClick={() =>
            useUi
              .getState()
              .set({ inspectorTab: 'decisions', openDecisionId: data.decisionIds![0]! })
          }
        >
          ADR{data.decisionIds.length > 1 ? ` ${data.decisionIds.length}` : ''}
        </button>
      )}
      {data.diff && (
        <>
          <div
            className={`pointer-events-none absolute -inset-1.5 rounded-xl border-2 ${data.diff === 'removed' ? 'border-dashed' : ''}`}
            style={{ borderColor: DIFF_COLOR[data.diff] }}
            aria-hidden
          />
          <span
            className="pointer-events-none absolute -top-5 left-0 rounded px-1 text-[10px] font-semibold text-white"
            style={{ background: DIFF_COLOR[data.diff] }}
            data-testid={`diff-${data.elementId}`}
          >
            {data.diff === 'added' ? 'new' : data.diff === 'removed' ? 'removed' : 'changed'}
          </span>
        </>
      )}
      {SIDES.map((s) => (
        <Handle key={s.id} id={s.id} type="source" position={s.position} className="ag-handle" />
      ))}
    </div>
  );
}

/** Problem count in the top-right corner; a click opens the Problems panel. */
function IssueBadge({
  id,
  issue,
}: {
  id: string;
  issue: NonNullable<ShapeFlowNode['data']['issue']>;
}) {
  const word = issue.count === 1 ? 'problem' : 'problems';
  return (
    <button
      type="button"
      className="ag-badge nodrag absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow"
      style={{ background: SEVERITY_COLOR[issue.severity] }}
      data-testid={`badge-${id}`}
      data-severity={issue.severity}
      aria-label={`${issue.count} ${issue.severity === 'info' ? 'tip' : word}, open the Problems panel`}
      title={`${issue.count} ${word}`}
      onClick={() =>
        useUi.getState().set(isPhone() ? { panel: 'problems' } : { problemsOpen: true })
      }
    >
      {issue.severity === 'info' ? 'i' : issue.count}
    </button>
  );
}

/** Name, concept, and the documentation's description and function, for the hover text. */
function tooltip(data: ShapeFlowNode['data']): string {
  const d = data.docs;
  const head = `${d?.name ?? data.name} — ${data.conceptName}${
    data.antiPattern ? `\n⚠ Anti-pattern found in the code: ${data.antiPattern}` : ''
  }`;
  if (!d) return head;
  return [
    d.name && d.name !== data.name ? `${head} (${data.name})` : head,
    d.description,
    d.function ? `⚙ ${d.function}` : undefined,
    d.lang ? `[${d.lang}]` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The repository's documentation under a shape: the description and the function, in the
 * language they were written in. The function's label is an icon, so no other language is
 * mixed into the text.
 */
function DocsCard({
  docs,
  id,
  below,
}: {
  docs: NonNullable<ShapeFlowNode['data']['docs']>;
  id: string;
  below: boolean;
}) {
  if (!docs.description && !docs.function) return null;
  return (
    <div
      className="ag-docs pointer-events-none absolute left-1/2 z-10 w-full min-w-44 -translate-x-1/2 space-y-0.5 rounded border border-[var(--ag-border)] bg-[var(--ag-panel)] px-1.5 py-1 text-[10px] leading-tight shadow-sm"
      style={{ top: below ? 'calc(100% + 2.75rem)' : 'calc(100% + 6px)' }}
      lang={docs.lang}
      dir={docs.dir ?? 'auto'}
      data-testid={`docs-${id}`}
    >
      {docs.description && <p className="line-clamp-3">{docs.description}</p>}
      {docs.function && (
        <p className="flex items-start gap-1">
          <Cog size={10} className="mt-px shrink-0 text-[var(--ag-muted)]" aria-label="Function" />
          <span className="line-clamp-2">{docs.function}</span>
        </p>
      )}
    </div>
  );
}

function Label({ data, className }: { data: ShapeFlowNode['data']; className: string }) {
  const name = data.docs?.name ?? data.name;
  if (data.editing) return <NameInput id={data.elementId} initial={name} />;
  return (
    <span
      className={className}
      data-role="label"
      {...(data.docs?.name ? { lang: data.docs.lang, dir: data.docs.dir ?? 'auto' } : {})}
    >
      {name}
    </span>
  );
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
