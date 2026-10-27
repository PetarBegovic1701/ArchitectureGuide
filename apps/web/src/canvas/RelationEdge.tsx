import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  useInternalNode,
} from '@xyflow/react';
import type { EdgeProps, InternalNode } from '@xyflow/react';
import type { RelationFlowEdge } from '../lib/flow';
import { SEVERITY_COLOR } from '../lib/findings';

/**
 * A relation drawn between the borders of its two shapes ("floating" edge), so handles
 * are only needed to start a connection. Line style comes from the relation type (§10.2).
 */
function RelationEdgeImpl({ id, source, target, data, selected }: EdgeProps<RelationFlowEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode || !data) return null;

  const ends = floatingEnds(sourceNode, targetNode);
  const { sourcePos, targetPos } = ends;
  // Spread parallel relations between the same two shapes side by side.
  const spread = (data.parallelIndex - (data.parallelCount - 1) / 2) * 22;
  const len = Math.hypot(ends.tx - ends.sx, ends.ty - ends.sy) || 1;
  // Normal of the line, oriented the same way for both directions of a pair.
  const flip = source < target ? 1 : -1;
  const nx = (-(ends.ty - ends.sy) / len) * spread * flip;
  const ny = ((ends.tx - ends.sx) / len) * spread * flip;
  const sx = ends.sx + nx;
  const sy = ends.sy + ny;
  const tx = ends.tx + nx;
  const ty = ends.ty + ny;
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
  });
  const { line, relation, typeName } = data;
  const issueColor = data.issue ? SEVERITY_COLOR[data.issue.severity] : undefined;
  const stroke = selected ? 'var(--ag-accent)' : (issueColor ?? 'var(--ag-edge)');
  const width = line.width + (selected ? 1 : 0) + (data.highlighted ? 2 : 0);
  const marker = MARKER_IDS[line.marker];
  const label = relation.label ? `${typeName}: ${relation.label}` : typeName;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={16}
        style={{
          stroke,
          strokeWidth: width,
          strokeDasharray: line.dash,
        }}
        {...(line.marker === 'diamond-tail'
          ? { markerStart: 'url(#ag-m-diamond)', markerEnd: 'url(#ag-m-arrow)' }
          : {})}
        {...(marker ? { markerEnd: `url(#${marker})` } : {})}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute rounded border px-1.5 py-0.5 text-[10px] leading-none"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            background: 'var(--ag-panel)',
            borderColor: selected ? 'var(--ag-accent)' : (issueColor ?? 'var(--ag-border)'),
            borderWidth: data.highlighted ? 2 : 1,
            color: 'var(--ag-muted)',
            zIndex: 1100,
          }}
          data-testid={`edge-label-${id}`}
          {...(data.issue ? { 'data-severity': data.issue.severity } : {})}
        >
          {data.issue && (
            <span
              className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
              style={{ background: issueColor }}
              aria-label={`${data.issue.count} ${data.issue.count === 1 ? 'problem' : 'problems'}`}
            />
          )}
          {label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const MARKER_IDS: Record<string, string | undefined> = {
  arrow: 'ag-m-arrow',
  'open-arrow': 'ag-m-open',
  'triangle-hollow': 'ag-m-triangle',
  'diamond-tail': undefined,
  none: undefined,
};

/** Point where the line between two node centers leaves each node's box. */
function floatingEnds(a: InternalNode, b: InternalNode) {
  const ca = center(a);
  const cb = center(b);
  const pa = boxExit(a, ca, cb);
  const pb = boxExit(b, cb, ca);
  return { sx: pa.x, sy: pa.y, tx: pb.x, ty: pb.y, sourcePos: pa.side, targetPos: pb.side };
}

function size(n: InternalNode) {
  return { w: n.measured.width ?? n.width ?? 0, h: n.measured.height ?? n.height ?? 0 };
}

function center(n: InternalNode) {
  const { w, h } = size(n);
  return { x: n.internals.positionAbsolute.x + w / 2, y: n.internals.positionAbsolute.y + h / 2 };
}

function boxExit(n: InternalNode, from: { x: number; y: number }, to: { x: number; y: number }) {
  const { w, h } = size(n);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { x: from.x, y: from.y, side: Position.Right };
  const scale = Math.min(Math.abs(w / 2 / (dx || 1e-9)), Math.abs(h / 2 / (dy || 1e-9)));
  const x = from.x + dx * scale;
  const y = from.y + dy * scale;
  const side =
    Math.abs(dx) * h > Math.abs(dy) * w
      ? dx > 0
        ? Position.Right
        : Position.Left
      : dy > 0
        ? Position.Bottom
        : Position.Top;
  return { x, y, side };
}

export const RelationEdge = memo(RelationEdgeImpl);

/** SVG markers used by relation edges. Rendered once per canvas. */
export function EdgeMarkers() {
  const fill = { fill: 'var(--ag-edge)' };
  const stroke = { stroke: 'var(--ag-edge)', fill: 'var(--ag-panel)', strokeWidth: 1.25 };
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <defs>
        <marker
          id="ag-m-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" style={fill} />
        </marker>
        <marker
          id="ag-m-open"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path
            d="M0,0 L10,5 L0,10"
            style={{ fill: 'none', stroke: 'var(--ag-edge)', strokeWidth: 1.5 }}
          />
        </marker>
        <marker
          id="ag-m-triangle"
          viewBox="0 0 12 12"
          refX="11"
          refY="6"
          markerWidth="10"
          markerHeight="10"
          orient="auto-start-reverse"
        >
          <path d="M1,1 L11,6 L1,11 z" style={stroke} />
        </marker>
        <marker
          id="ag-m-diamond"
          viewBox="0 0 12 12"
          refX="1"
          refY="6"
          markerWidth="10"
          markerHeight="10"
          orient="auto"
        >
          <path d="M1,6 L6,1 L11,6 L6,11 z" style={stroke} />
        </marker>
      </defs>
    </svg>
  );
}
