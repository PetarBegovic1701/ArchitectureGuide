import { PALETTE_GROUPS, SHAPES } from '@archguide/core';
import type { ShapeId } from '@archguide/core';
import { catalog, shapeFor } from '../lib/catalog';
import { colorOf } from '../lib/model';
import { iconFor } from '../canvas/icons';
import { ShapeSvg } from '../canvas/shapes';

/** Every shape and every concept, to review the visual language (§9.2). */
export function Gallery() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <a href="#/" className="text-sm text-[var(--ag-accent)] hover:underline">
        ← Back to projects
      </a>
      <h1 className="mb-4 mt-2 text-xl font-bold">Shape gallery</h1>
      <h2 className="mb-2 font-semibold">Shapes</h2>
      <div className="mb-8 flex flex-wrap gap-6">
        {(Object.keys(SHAPES) as ShapeId[]).map((id) => (
          <figure key={id} className="flex flex-col items-center gap-1">
            <div
              className="relative"
              style={{ width: SHAPES[id].width, height: SHAPES[id].height }}
            >
              <ShapeSvg
                shape={id}
                w={SHAPES[id].width}
                h={SHAPES[id].height}
                color="var(--ag-application)"
              />
            </div>
            <figcaption className="text-xs text-[var(--ag-muted)]">{id}</figcaption>
          </figure>
        ))}
      </div>
      {PALETTE_GROUPS.map((group) => {
        const concepts = [...catalog.concepts.values()].filter((c) => c.palette.group === group);
        if (concepts.length === 0) return null;
        return (
          <section key={group} className="mb-6">
            <h2 className="mb-2 font-semibold">{group}</h2>
            <div className="flex flex-wrap gap-6">
              {concepts.map((c) => {
                const shape = shapeFor(c.id);
                const { width, height } = SHAPES[shape];
                const Icon = iconFor(c.icon);
                const color = colorOf({ id: 'x', kind: c.id, name: c.name, status: 'existing' });
                return (
                  <figure
                    key={c.id}
                    className="flex flex-col items-center gap-1 text-center"
                    style={{ width: Math.max(160, width) }}
                  >
                    <div className="relative" style={{ width, height }}>
                      <ShapeSvg shape={shape} w={width} h={height} color={color} />
                      <Icon
                        size={14}
                        className="absolute left-2 top-2"
                        style={{ color }}
                        aria-hidden
                      />
                    </div>
                    <figcaption className="text-xs">
                      {c.name}
                      <span className="block text-[var(--ag-muted)]">{c.id}</span>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </section>
        );
      })}
    </main>
  );
}
