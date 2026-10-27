import { z } from 'zod';
import { ElementSchema, IdSchema, RelationSchema, ViewNodeSchema } from '../schema';
import type { Element, Id, Project, View } from '../schema';
import type { Template } from './types';

export const TEMPLATE_FILE_FORMAT = 'archguide-template';

/**
 * A template saved from a selection (Implementation.md §12.1): plain data, no parameters.
 * Shared as `*.archguide-template.json`.
 */
export const TemplateFileSchema = z.object({
  format: z.literal(TEMPLATE_FILE_FORMAT),
  schemaVersion: z.literal(1),
  id: IdSchema,
  name: z.string().min(1),
  summary: z.string().optional(),
  profile: z.string().min(1),
  version: z.string().min(1),
  createdAt: z.string().optional(),
  elements: z.array(ElementSchema).min(1),
  relations: z.array(RelationSchema),
  /** Top-level positions are relative to the template's top-left corner. */
  nodes: z.array(ViewNodeSchema),
});
export type TemplateFile = z.infer<typeof TemplateFileSchema>;

/** Absolute position of a view node: nested positions are relative to a shown parent. */
function absolute(p: Project, view: View, id: Id): { x: number; y: number } {
  const node = view.nodes.find((n) => n.elementId === id);
  if (!node) return { x: 0, y: 0 };
  const parentId = p.model.elements.find((e) => e.id === id)?.parentId;
  if (parentId && view.nodes.some((n) => n.elementId === parentId)) {
    const at = absolute(p, view, parentId);
    return { x: at.x + node.x, y: at.y + node.y };
  }
  return { x: node.x, y: node.y };
}

/**
 * A template file from selected elements, their descendants, and the relations between
 * them. Parents outside the selection are dropped; positions are kept.
 */
export function templateFromSelection(
  p: Project,
  view: View,
  selectedIds: readonly Id[],
  meta: { id: Id; name: string; summary?: string; createdAt?: string },
): TemplateFile {
  const included = new Set<Id>();
  const add = (id: Id) => {
    if (included.has(id)) return;
    included.add(id);
    for (const child of p.model.elements.filter((e) => e.parentId === id)) add(child.id);
  };
  for (const id of selectedIds) if (p.model.elements.some((e) => e.id === id)) add(id);
  if (included.size === 0) throw new Error('Select at least one element to save as a template.');

  const elements: Element[] = p.model.elements
    .filter((e) => included.has(e.id))
    .map(({ source: _source, ...e }) => {
      if (e.parentId && included.has(e.parentId)) return e;
      const { parentId: _parent, ...top } = e;
      return top;
    });
  const top = elements.filter((e) => !e.parentId);
  const shown = (id: Id) => view.nodes.some((n) => n.elementId === id);
  const corner = top.filter((e) => shown(e.id)).map((e) => absolute(p, view, e.id));
  const minX = Math.min(...corner.map((c) => c.x), Number.POSITIVE_INFINITY);
  const minY = Math.min(...corner.map((c) => c.y), Number.POSITIVE_INFINITY);
  const dx = Number.isFinite(minX) ? minX : 0;
  const dy = Number.isFinite(minY) ? minY : 0;
  const nodes = elements
    .filter((e) => shown(e.id))
    .map((e) => {
      const node = view.nodes.find((n) => n.elementId === e.id)!;
      if (e.parentId) return node;
      const at = absolute(p, view, e.id);
      return { ...node, x: at.x - dx, y: at.y - dy };
    });

  return {
    format: TEMPLATE_FILE_FORMAT,
    schemaVersion: 1,
    id: meta.id,
    name: meta.name,
    ...(meta.summary ? { summary: meta.summary } : {}),
    profile: p.profile,
    version: '1.0.0',
    ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
    elements,
    relations: p.model.relations
      .filter((r) => included.has(r.sourceId) && included.has(r.targetId))
      .map(({ source: _source, ...r }) => r),
    nodes,
  };
}

/** Parses a template file; throws with a readable message when it is not one. */
export function parseTemplateFile(text: string): TemplateFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  const result = TemplateFileSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `Not an ArchitectureGuide template: ${issue?.path.join('.') || 'file'}: ${issue?.message}`,
    );
  }
  return result.data;
}

export function serializeTemplateFile(file: TemplateFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A template that recreates a saved selection (new IDs, same names and layout). */
export function templateFromFile(file: TemplateFile): Template {
  return {
    id: `custom.${file.id}`,
    code: 'Custom',
    version: file.version,
    name: file.name,
    category: 'fullstack',
    summary: file.summary ?? 'Saved from a selection.',
    whenToUse: [],
    whenNotToUse: [],
    tradeoffs: [],
    parameters: [],
    rulePacks: [],
    invariants: [],
    build(_params, b) {
      const pos = new Map(file.nodes.map((n) => [n.elementId, n]));
      // Parents first, so children can refer to them.
      const depth = (e: Element): number => {
        const parent = file.elements.find((x) => x.id === e.parentId);
        return parent ? 1 + depth(parent) : 0;
      };
      for (const e of [...file.elements].sort((a, b2) => depth(a) - depth(b2))) {
        const { id, kind, name, parentId, status: _status, ...extra } = e;
        const at = pos.get(id) ?? { x: 0, y: 0 };
        b.el(id, kind, name, {
          ...extra,
          ...(parentId ? { parent: parentId } : {}),
          x: at.x,
          y: at.y,
        });
      }
      for (const r of file.relations) {
        const { id: _id, type, sourceId, targetId, status: _status, source: _source, ...extra } = r;
        b.rel(sourceId, type, targetId, extra);
      }
    },
  };
}
