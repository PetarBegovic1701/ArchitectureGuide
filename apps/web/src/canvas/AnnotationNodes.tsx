import { memo, useEffect, useRef, useState } from 'react';
import { NodeResizer, NodeToolbar, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Check, MessageSquare, RotateCcw, Trash2 } from 'lucide-react';
import type { Annotation } from '@archguide/core';
import type { AnnotationFlowNode } from '../lib/flow';
import { ANNOTATION_COLORS, CALLOUT_WIDTH } from '../lib/annotations';
import { removeAnnotation, replyToComment, updateAnnotation } from '../actions';
import { useUi } from '../store/ui';

type Props = NodeProps<AnnotationFlowNode>;

/** Text that turns into a textarea while editing. Enter + Ctrl/Cmd or leaving the field saves. */
function EditableText({
  annotation,
  editing,
  className,
  placeholder,
}: {
  annotation: Annotation;
  editing: boolean;
  className: string;
  placeholder: string;
}) {
  const [value, setValue] = useState(annotation.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setValue(annotation.text), [annotation.text]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  const finish = (save: boolean) => {
    if (save && value !== annotation.text) updateAnnotation(annotation.id, { text: value });
    if (!save) setValue(annotation.text);
    useUi.getState().set({ editingAnnotation: null });
  };
  if (!editing)
    return (
      <div className={`${className} whitespace-pre-wrap break-words`}>
        {annotation.text || <span className="opacity-50">{placeholder}</span>}
      </div>
    );
  return (
    <textarea
      ref={ref}
      aria-label={`${annotation.kind} text`}
      className={`nodrag nowheel ${className} resize-none bg-transparent outline-none`}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') finish(false);
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true);
      }}
    />
  );
}

const startEditing = (id: string) =>
  useUi.getState().set({ selectedAnnotation: id, editingAnnotation: id });

/** Color swatches and delete, above a selected sticky note, region or callout. */
function Toolbar({ annotation, visible }: { annotation: Annotation; visible: boolean }) {
  return (
    <NodeToolbar isVisible={visible} position={Position.Top} className="flex gap-1">
      <div className="flex items-center gap-1 rounded border border-[var(--ag-border)] bg-[var(--ag-panel)] p-1 shadow">
        {annotation.kind !== 'callout' &&
          ANNOTATION_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              className="h-4 w-4 rounded-full border border-black/10"
              style={{ background: c }}
              onClick={() => updateAnnotation(annotation.id, { color: c }, 'Color')}
            />
          ))}
        <button
          type="button"
          aria-label={`Delete ${annotation.kind}`}
          className="rounded p-0.5 text-[var(--ag-error)] hover:bg-[var(--ag-panel-2)]"
          onClick={() => removeAnnotation(annotation.id)}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </NodeToolbar>
  );
}

function resizeHandler(annotation: Annotation) {
  return (_: unknown, p: { x: number; y: number; width: number; height: number }) =>
    updateAnnotation(
      annotation.id,
      {
        anchor: {
          x: Math.round(p.x),
          y: Math.round(p.y),
          w: Math.round(p.width),
          h: Math.round(p.height),
        },
      },
      'Resize',
    );
}

function StickyImpl({ data, selected }: Props) {
  const a = data.annotation;
  return (
    <div
      className="h-full w-full rounded-sm p-2 text-sm text-slate-900 shadow-md"
      style={{ background: a.color ?? ANNOTATION_COLORS[0] }}
      onDoubleClick={() => startEditing(a.id)}
      data-testid={`sticky-${a.id}`}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={100}
        minHeight={60}
        onResizeEnd={resizeHandler(a)}
      />
      <Toolbar annotation={a} visible={selected && !data.editing} />
      <EditableText
        annotation={a}
        editing={data.editing}
        className="h-full w-full"
        placeholder="Double-click to write"
      />
    </div>
  );
}

function RegionImpl({ data, selected }: Props) {
  const a = data.annotation;
  const color = a.color ?? ANNOTATION_COLORS[2];
  return (
    <div
      className="h-full w-full rounded-xl border-2 border-dashed"
      style={{ borderColor: color, background: `color-mix(in srgb, ${color} 18%, transparent)` }}
      data-testid={`region-${a.id}`}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={100}
        onResizeEnd={resizeHandler(a)}
      />
      <Toolbar annotation={a} visible={selected && !data.editing} />
      <div
        className="ag-region-header inline-block max-w-full cursor-grab rounded-br-lg rounded-tl-lg px-2 py-0.5 text-xs font-semibold text-slate-900"
        style={{ background: color }}
        onDoubleClick={() => startEditing(a.id)}
      >
        <EditableText
          annotation={a}
          editing={data.editing}
          className="min-w-24"
          placeholder="Region"
        />
      </div>
    </div>
  );
}

function CalloutImpl({ data, selected }: Props) {
  const a = data.annotation;
  const leader = data.leader ?? { x: 0, y: 0 };
  return (
    <div className="relative" style={{ width: CALLOUT_WIDTH }} data-testid={`callout-${a.id}`}>
      <svg
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        width="1"
        height="1"
        aria-hidden
      >
        <line
          x1={CALLOUT_WIDTH / 2}
          y1={30}
          x2={leader.x}
          y2={leader.y}
          stroke="var(--ag-muted)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        <circle cx={leader.x} cy={leader.y} r={3} fill="var(--ag-muted)" />
      </svg>
      <Toolbar annotation={a} visible={selected && !data.editing} />
      <div
        className="relative rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] p-2 text-sm shadow"
        onDoubleClick={() => startEditing(a.id)}
      >
        <EditableText
          annotation={a}
          editing={data.editing}
          className="w-full"
          placeholder="Explain this part"
        />
      </div>
    </div>
  );
}

function CommentImpl({ data }: Props) {
  const a = data.annotation;
  const open = useUi((s) => s.openComment === a.id);
  const [reply, setReply] = useState('');
  const count = 1 + (a.replies?.length ?? 0);
  return (
    <div className="relative" data-testid={`comment-${a.id}`}>
      <button
        type="button"
        className={`flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-full rounded-bl-none px-1.5 text-xs font-semibold text-white shadow ${a.resolved ? 'opacity-50' : ''}`}
        style={{ background: 'var(--ag-accent)' }}
        aria-label={`Comment${data.anchorName ? ` on ${data.anchorName}` : ''}: ${a.text || 'empty'}`}
        onClick={() =>
          useUi.getState().set({ openComment: open ? null : a.id, selectedAnnotation: a.id })
        }
      >
        <MessageSquare size={12} aria-hidden />
        {count > 1 && count}
      </button>
      {open && (
        <div
          className="nodrag nowheel nopan absolute left-9 top-0 z-10 w-72 space-y-2 rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] p-3 text-sm shadow-xl"
          role="dialog"
          aria-label="Comment thread"
        >
          {data.anchorName && (
            <div className="text-xs text-[var(--ag-muted)]">On {data.anchorName}</div>
          )}
          <EditableText
            annotation={a}
            editing={data.editing}
            className="w-full"
            placeholder="Write a comment…"
          />
          {(a.replies ?? []).map((r, i) => (
            <p key={i} className="border-l-2 border-[var(--ag-border)] pl-2">
              {r.text}
            </p>
          ))}
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              replyToComment(a.id, reply);
              setReply('');
            }}
          >
            <input
              aria-label="Reply"
              className="min-w-0 flex-1 rounded border border-[var(--ag-border)] bg-transparent px-1.5 py-0.5 text-sm outline-none focus:border-[var(--ag-accent)]"
              placeholder="Reply…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </form>
          <div className="flex gap-1">
            <button
              type="button"
              className="flex items-center gap-1 rounded border border-[var(--ag-border)] px-1.5 py-0.5 text-xs hover:bg-[var(--ag-panel-2)]"
              onClick={() => {
                updateAnnotation(
                  a.id,
                  { resolved: !a.resolved },
                  a.resolved ? 'Reopen' : 'Resolve',
                );
                useUi.getState().set({ openComment: null });
              }}
            >
              {a.resolved ? <RotateCcw size={12} /> : <Check size={12} />}
              {a.resolved ? 'Reopen' : 'Resolve'}
            </button>
            <button
              type="button"
              className="rounded border border-[var(--ag-border)] px-1.5 py-0.5 text-xs text-[var(--ag-error)] hover:bg-[var(--ag-panel-2)]"
              onClick={() => removeAnnotation(a.id)}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const annotationNodeTypes = {
  sticky: memo(StickyImpl),
  region: memo(RegionImpl),
  callout: memo(CalloutImpl),
  comment: memo(CommentImpl),
};
