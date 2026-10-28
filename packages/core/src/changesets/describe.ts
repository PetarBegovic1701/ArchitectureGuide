import { diffProjects } from '../diff';
import type { Element, Id, ModelOp, Project, Relation } from '../schema';

const short = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '–';
  if (Array.isArray(v)) return v.map(short).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const patchKeys = (patch: Record<string, unknown>) => Object.keys(patch).sort().join(', ');

/** One line per op, for the change-set panel and `get_change_set` (§20.2). */
export function describeOp(op: ModelOp, project?: Project): string {
  const rel = (id: Id) => {
    const r = project?.model.relations.find((x) => x.id === id);
    return r ? `${r.sourceId} ${r.type} ${r.targetId}` : id;
  };
  switch (op.op) {
    case 'addElement':
      return `Add ${op.element.id} (${op.element.kind})${op.element.parentId ? ` in ${op.element.parentId}` : ''}`;
    case 'updateElement':
      return `Change ${op.id}: ${patchKeys(op.patch)}`;
    case 'removeElement':
      return `Remove ${op.id}${op.cascade ? ' and what is inside' : ''}`;
    case 'moveElement':
      return op.parentId ? `Move ${op.id} into ${op.parentId}` : `Move ${op.id} to the top level`;
    case 'addRelation':
      return `Add ${op.relation.sourceId} ${op.relation.type} ${op.relation.targetId}`;
    case 'updateRelation':
      return `Change ${rel(op.id)}: ${patchKeys(op.patch)}`;
    case 'removeRelation':
      return `Remove ${rel(op.id)}`;
    case 'renameId':
      return `Rename ${op.from} to ${op.to}`;
    case 'addView':
      return `Add view ${op.view.name}`;
    case 'updateView':
      return `Change view ${op.id}`;
    case 'removeView':
      return `Remove view ${op.id}`;
    case 'setViewNode':
      return `Place ${op.node.elementId} in view ${op.viewId}`;
    case 'removeViewNode':
      return `Hide ${op.elementId} in view ${op.viewId}`;
    case 'setViewEdge':
      return `Route ${op.edge.relationId} in view ${op.viewId}`;
    case 'removeViewEdge':
      return `Reset route of ${op.relationId} in view ${op.viewId}`;
    case 'upsertAnnotation':
      return `Annotate view ${op.viewId}`;
    case 'removeAnnotation':
      return `Remove annotation ${op.id}`;
    case 'upsertNote':
      return `Note ${op.note.id}`;
    case 'removeNote':
      return `Remove note ${op.id}`;
    case 'upsertDecision':
      return `Decision ${op.decision.id}: ${op.decision.title}`;
    case 'removeDecision':
      return `Remove decision ${op.id}`;
    case 'upsertTour':
      return `Tour ${op.tour.id}`;
    case 'removeTour':
      return `Remove tour ${op.id}`;
    case 'upsertSuppression':
      return `Suppress ${op.suppression.ruleId} on ${op.suppression.targetIds.join(', ')}`;
    case 'removeSuppression':
      return `Unsuppress ${op.ruleId} on ${op.targetIds.join(', ')}`;
    case 'updateProject':
      return `Change project: ${patchKeys(op.patch)}`;
    case 'updateSettings':
      return `Change settings: ${patchKeys(op.patch)}`;
  }
}

/** A row of the plan's "Changes" table (§18.4). */
export interface ChangeRow {
  op: 'ADD' | 'CHANGE' | 'REMOVE';
  kind: 'element' | 'relation';
  id: Id;
  item: string;
  details: string;
}

export function elementDetails(e: Element): string {
  const parts: string[] = [];
  if (e.parentId) parts.push(`in ${e.parentId}`);
  if (e.tech) parts.push(e.tech);
  if (e.description) parts.push(`"${e.description}"`);
  else if (e.responsibilities?.length) parts.push(`"${e.responsibilities.join('; ')}"`);
  for (const [k, v] of Object.entries(e.properties ?? {})) {
    if (typeof v === 'object' && !Array.isArray(v)) continue;
    if (Array.isArray(v) && v.some((x) => typeof x === 'object')) continue;
    parts.push(`${k} ${short(v)}`);
  }
  if (e.codePaths?.length) parts.push(`code: ${e.codePaths.join(', ')}`);
  return parts.join('; ');
}

export function relationSummary(r: Relation): string {
  const parts: string[] = [];
  if (r.protocol) parts.push(r.protocol);
  if (r.label) parts.push(r.label);
  if (r.via) parts.push(`via ${r.via}`);
  if (r.mode === 'async') parts.push('async');
  if (r.inTransaction) parts.push('inTransaction: true');
  return parts.join('; ');
}

function fieldChanges(before: object, after: object, fields: readonly string[]): string {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  return fields
    .map((f) => {
      const [x, y] = [a[f], b[f]];
      const scalar = (v: unknown) => v === undefined || typeof v !== 'object';
      if (scalar(x) && scalar(y)) return `${f}: ${short(x)} → ${short(y)}`;
      if (f === 'properties') {
        const px = (x ?? {}) as Record<string, unknown>;
        const py = (y ?? {}) as Record<string, unknown>;
        const keys = [...new Set([...Object.keys(px), ...Object.keys(py)])]
          .filter((k) => JSON.stringify(px[k]) !== JSON.stringify(py[k]))
          .sort();
        return keys.map((k) => `${k}: ${short(px[k])} → ${short(py[k])}`).join('; ');
      }
      return `${f} changed`;
    })
    .join('; ');
}

/**
 * The net changes from the baseline to the effective model, as table rows: added elements,
 * added relations, changes, then removals. View-only ops leave no row.
 */
export function describeChanges(baseline: Project, effective: Project): ChangeRow[] {
  const d = diffProjects(baseline, effective);
  const el = (p: Project, id: Id) => p.model.elements.find((e) => e.id === id)!;
  const rl = (p: Project, id: Id) => p.model.relations.find((r) => r.id === id)!;
  const relItem = (r: Relation) => `${r.sourceId} ${r.type} ${r.targetId}`;
  const rows: ChangeRow[] = [];
  // Parents before children: the order the table reads best in.
  const depth = (id: Id) => {
    let n = 0;
    for (let e = el(effective, id); e?.parentId && n < 50; e = el(effective, e.parentId)) n++;
    return n;
  };
  const added = [...d.added.elements].sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1));
  for (const id of added) {
    const e = el(effective, id);
    rows.push({
      op: 'ADD',
      kind: 'element',
      id,
      item: `${id} (${e.kind})`,
      details: elementDetails(e),
    });
  }
  for (const id of d.added.relations) {
    const r = rl(effective, id);
    rows.push({ op: 'ADD', kind: 'relation', id, item: relItem(r), details: relationSummary(r) });
  }
  for (const c of d.changed) {
    if (c.kind === 'element') {
      rows.push({
        op: 'CHANGE',
        kind: 'element',
        id: c.id,
        item: c.id,
        details: fieldChanges(el(baseline, c.id), el(effective, c.id), c.fields),
      });
    } else {
      const r = rl(effective, c.id);
      rows.push({
        op: 'CHANGE',
        kind: 'relation',
        id: c.id,
        item: relItem(r),
        details: fieldChanges(rl(baseline, c.id), r, c.fields),
      });
    }
  }
  for (const id of d.removed.elements) {
    const e = el(baseline, id);
    rows.push({ op: 'REMOVE', kind: 'element', id, item: `${id} (${e.kind})`, details: e.name });
  }
  for (const id of d.removed.relations) {
    const r = rl(baseline, id);
    rows.push({ op: 'REMOVE', kind: 'relation', id, item: relItem(r), details: '' });
  }
  return rows;
}
