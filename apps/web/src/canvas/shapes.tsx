import type { ShapeId } from '@archguide/core';

interface ShapeProps {
  shape: ShapeId;
  w: number;
  h: number;
  /** Stroke color; the fill is the same color at low opacity. */
  color: string;
  selected?: boolean;
  /** Planned elements are drawn with a dashed outline (§9.3). */
  dashed?: boolean;
  muted?: boolean;
}

const S = 1.5; // half the stroke width, so strokes are not clipped

/** Draws one shape of the visual language (Implementation.md §9.2) as inline SVG. */
export function ShapeSvg({ shape, w, h, color, selected, dashed, muted }: ShapeProps) {
  const stroke = selected ? 'var(--ag-accent)' : color;
  const common = {
    // Containers are see-through so the arrows below them stay visible.
    fill: muted
      ? `color-mix(in srgb, ${color} 5%, transparent)`
      : `color-mix(in srgb, ${color} 14%, var(--ag-panel))`,
    stroke,
    strokeWidth: selected ? 2.5 : 1.75,
    strokeDasharray:
      dashed || shape === 'cylinder-dashed' || shape === 'container' ? '6 4' : undefined,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  return (
    <svg
      className="ag-shape pointer-events-none absolute inset-0 overflow-visible"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
    >
      {draw(shape, w, h, common, stroke)}
    </svg>
  );
}

type Common = Record<string, unknown>;

function draw(shape: ShapeId, w: number, h: number, c: Common, stroke: string) {
  const x0 = S;
  const y0 = S;
  const x1 = w - S;
  const y1 = h - S;
  const W = x1 - x0;
  const H = y1 - y0;
  switch (shape) {
    case 'rect':
      return <rect x={x0} y={y0} width={W} height={H} rx={4} {...c} />;
    case 'rounded':
      return <rect x={x0} y={y0} width={W} height={H} rx={16} {...c} />;
    case 'window':
      return (
        <>
          <rect x={x0} y={y0} width={W} height={H} rx={6} {...c} />
          <line x1={x0} y1={y0 + 16} x2={x1} y2={y0 + 16} stroke={stroke} strokeWidth={1.25} />
          {[10, 20, 30].map((dx) => (
            <circle key={dx} cx={x0 + dx} cy={y0 + 8} r={2.5} fill={stroke} />
          ))}
        </>
      );
    case 'hexagon':
    case 'hexagon-sm':
      return (
        <polygon
          points={pts(
            [x0 + W * 0.25, y0],
            [x0 + W * 0.75, y0],
            [x1, y0 + H / 2],
            [x0 + W * 0.75, y1],
            [x0 + W * 0.25, y1],
            [x0, y0 + H / 2],
          )}
          {...c}
        />
      );
    case 'circle':
      return <ellipse cx={w / 2} cy={h / 2} rx={W / 2} ry={H / 2} {...c} />;
    case 'plug':
      return (
        <>
          <rect x={x0 + 8} y={y0} width={W - 8} height={H} rx={10} {...c} />
          <rect
            x={x0}
            y={y0 + H / 2 - 9}
            width={10}
            height={6}
            rx={1}
            {...c}
            strokeDasharray={undefined}
          />
          <rect
            x={x0}
            y={y0 + H / 2 + 3}
            width={10}
            height={6}
            rx={1}
            {...c}
            strokeDasharray={undefined}
          />
        </>
      );
    case 'cylinder':
    case 'cylinder-dashed': {
      const ry = Math.min(12, H / 6);
      return (
        <>
          <path
            d={`M${x0},${y0 + ry} A${W / 2},${ry} 0 0 1 ${x1},${y0 + ry} V${y1 - ry} A${W / 2},${ry} 0 0 1 ${x0},${y1 - ry} Z`}
            {...c}
          />
          <path
            d={`M${x0},${y0 + ry} A${W / 2},${ry} 0 0 0 ${x1},${y0 + ry}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1.25}
          />
        </>
      );
    }
    case 'pipe': {
      const rx = Math.min(14, W / 8);
      return (
        <>
          <path
            d={`M${x0 + rx},${y0} H${x1 - rx} A${rx},${H / 2} 0 0 1 ${x1 - rx},${y1} H${x0 + rx} A${rx},${H / 2} 0 0 1 ${x0 + rx},${y0} Z`}
            {...c}
          />
          <path
            d={`M${x1 - rx},${y0} A${rx},${H / 2} 0 0 0 ${x1 - rx},${y1}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1.25}
          />
        </>
      );
    }
    case 'triangle':
      return <polygon points={pts([w / 2, y0], [x1, y1], [x0, y1])} {...c} />;
    case 'diamond':
      return <polygon points={pts([w / 2, y0], [x1, h / 2], [w / 2, y1], [x0, h / 2])} {...c} />;
    case 'octagon': {
      const k = Math.min(W, H) * 0.29;
      return (
        <polygon
          points={pts(
            [x0 + k, y0],
            [x1 - k, y0],
            [x1, y0 + k],
            [x1, y1 - k],
            [x1 - k, y1],
            [x0 + k, y1],
            [x0, y1 - k],
            [x0, y0 + k],
          )}
          {...c}
        />
      );
    }
    case 'actor': {
      const r = Math.min(W, H) * 0.2;
      return (
        <>
          <circle cx={w / 2} cy={y0 + r} r={r} {...c} />
          <path
            d={`M${x0 + W * 0.1},${y1} C${x0 + W * 0.1},${y0 + r * 2.4} ${x1 - W * 0.1},${y0 + r * 2.4} ${x1 - W * 0.1},${y1} Z`}
            {...c}
          />
        </>
      );
    }
    case 'cloud':
      return (
        <path
          d={`M${x0 + W * 0.25},${y1} C${x0 - W * 0.02},${y1} ${x0 - W * 0.02},${y0 + H * 0.45} ${x0 + W * 0.2},${y0 + H * 0.42}
             C${x0 + W * 0.18},${y0 + H * 0.05} ${x0 + W * 0.55},${y0 - H * 0.02} ${x0 + W * 0.62},${y0 + H * 0.25}
             C${x0 + W * 0.8},${y0 + H * 0.1} ${x1 + W * 0.02},${y0 + H * 0.35} ${x1 - W * 0.08},${y0 + H * 0.55}
             C${x1 + W * 0.02},${y0 + H * 0.7} ${x1 - W * 0.05},${y1} ${x1 - W * 0.22},${y1} Z`}
          {...c}
        />
      );
    case 'gear':
      return (
        <>
          <rect x={x0} y={y0} width={W} height={H} rx={10} {...c} />
          <circle
            cx={x1 - 10}
            cy={y0 + 10}
            r={5}
            fill="none"
            stroke={stroke}
            strokeWidth={1.25}
            strokeDasharray="2 1.5"
          />
        </>
      );
    case 'document': {
      const f = Math.min(16, W / 5);
      return (
        <>
          <path d={`M${x0},${y0} H${x1 - f} L${x1},${y0 + f} V${y1} H${x0} Z`} {...c} />
          <path
            d={`M${x1 - f},${y0} V${y0 + f} H${x1}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1.25}
          />
        </>
      );
    }
    case 'container':
      return <rect x={x0} y={y0} width={W} height={H} rx={8} {...c} />;
  }
}

function pts(...points: [number, number][]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

/** Shapes too small to hold a label inside; their label sits below the shape. */
export const LABEL_BELOW: ReadonlySet<ShapeId> = new Set(['circle', 'actor', 'triangle']);
