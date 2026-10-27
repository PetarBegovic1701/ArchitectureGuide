import { allTemplates, applyOps, createProject, instantiateTemplate } from '@archguide/core';
import type { Id, Op, Project, Template, View } from '@archguide/core';
import { DEFAULT_PROFILE, catalog } from './catalog';
import { absolutePosition, elementById, nodeSize } from './model';
import type { Point } from './model';

/** Built-in templates of the active profile (§12.2). */
export const BUILTIN_TEMPLATES: readonly Template[] = allTemplates(catalog);

/** A new project made from a template. */
export function projectFromTemplate(
  template: Template,
  params: Record<string, unknown>,
  meta: { id: Id; name: string; now?: string },
): Project {
  const base = createProject({
    id: meta.id,
    name: meta.name,
    description: template.summary,
    profile: DEFAULT_PROFILE,
    ...(meta.now ? { now: meta.now } : {}),
  });
  const { ops } = instantiateTemplate(template, base, catalog, {
    params,
    origin: { x: 40, y: 40 },
  });
  const result = applyOps(base, ops, catalog);
  if (!result.ok)
    throw new Error(result.errors[0]?.message ?? 'The template could not be applied.');
  return result.project;
}

/** Where a stamped template goes: right of everything in the view, or at `fallback`. */
export function stampOrigin(p: Project, view: View, fallback: Point): Point {
  const top = view.nodes.filter((n) => {
    const parent = elementById(p, n.elementId)?.parentId;
    return !parent || !view.nodes.some((m) => m.elementId === parent);
  });
  if (top.length === 0) return fallback;
  const boxes = top.map((n) => ({
    ...absolutePosition(p, view, n.elementId),
    ...nodeSize(p, view, n.elementId),
  }));
  return {
    x: Math.max(...boxes.map((b) => b.x + b.w)) + 120,
    y: Math.min(...boxes.map((b) => b.y)),
  };
}

/** Ops that add a template to the open project, and the IDs of its top-level elements. */
export function stampOps(
  p: Project,
  view: View,
  template: Template,
  params: Record<string, unknown>,
  origin: Point,
): { ops: Op[]; rootIds: Id[] } {
  const { ops, rootIds } = instantiateTemplate(template, p, catalog, {
    params,
    viewId: view.id,
    origin,
  });
  return { ops, rootIds };
}
