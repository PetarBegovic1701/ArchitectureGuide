import { slugify, uniqueId } from '../ids';
import type { Element, Id, Model, ModelOp, Relation } from '../schema';
import type { AnalysisDiff } from './types';

const normName = (name: string) => slugify(name);

const segments = (p: string) =>
  p
    .replace(/\\/g, '/')
    .replace(/^\.\/|\/+$/g, '')
    .split('/');
/** One path is the other, or inside it. */
function pathsOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((x) =>
    b.some((y) => {
      const [s, t] = [segments(x), segments(y)];
      const n = Math.min(s.length, t.length);
      return s.slice(0, n).join('/') === t.slice(0, n).join('/');
    }),
  );
}

function depthOf(e: Element, byId: Map<Id, Element>): number {
  let d = 0;
  for (let p = e.parentId; p && d < 50; p = byId.get(p)?.parentId) d++;
  return d;
}

/**
 * Candidates vs the existing model (§19.6). Per candidate, parents first, the first rule
 * that hits: the same ID (and kind); overlapping `codePaths` with the same kind; the same
 * kind and name inside the same parent. The diff never removes anything: model elements
 * the code no longer shows are listed in `missingInCode` for a finding.
 */
export function matchModel(
  model: Model,
  candidates: Model,
  options: { detectableKinds?: ReadonlySet<string> } = {},
): AnalysisDiff {
  const modelById = new Map(model.elements.map((e) => [e.id, e]));
  const candById = new Map(candidates.elements.map((e) => [e.id, e]));
  const ordered = [...candidates.elements].sort(
    (a, b) => depthOf(a, candById) - depthOf(b, candById) || a.id.localeCompare(b.id),
  );
  const matches: Record<Id, Id> = {};
  const used = new Set<Id>();
  const mappedParent = (c: Element) => (c.parentId ? matches[c.parentId] : undefined);

  for (const c of ordered) {
    const free = model.elements.filter((e) => !used.has(e.id) && e.kind === c.kind);
    const hit =
      free.find((e) => e.id === c.id) ??
      (c.codePaths?.length
        ? free.find((e) => e.codePaths?.length && pathsOverlap(e.codePaths, c.codePaths!))
        : undefined) ??
      free.find(
        (e) =>
          normName(e.name) === normName(c.name) &&
          (e.parentId ?? null) === (mappedParent(c) ?? null),
      );
    if (hit) {
      matches[c.id] = hit.id;
      used.add(hit.id);
    }
  }

  const changed: AnalysisDiff['changed'] = [];
  const suggestedOps: ModelOp[] = [];
  const taken = new Set<Id>(model.elements.map((e) => e.id));
  const idFor = new Map<Id, Id>(Object.entries(matches));

  for (const c of ordered) {
    const m = matches[c.id] ? modelById.get(matches[c.id]!) : undefined;
    if (m) {
      const fields: string[] = [];
      if (c.tech && m.tech && c.tech !== m.tech) fields.push('tech');
      const parent = mappedParent(c);
      if (c.parentId && parent !== (m.parentId ?? undefined)) fields.push('parent');
      const missingPaths = (c.codePaths ?? []).filter((p) => !(m.codePaths ?? []).includes(p));
      if (missingPaths.length) {
        fields.push('codePaths');
        suggestedOps.push({
          op: 'updateElement',
          id: m.id,
          patch: { codePaths: [...(m.codePaths ?? []), ...missingPaths].sort() },
        });
      }
      if (fields.length) changed.push({ id: m.id, fields });
      continue;
    }
    const id = uniqueId(c.id, taken);
    taken.add(id);
    idFor.set(c.id, id);
    const parentId = c.parentId ? idFor.get(c.parentId) : undefined;
    const { parentId: _parent, ...rest } = c;
    suggestedOps.push({
      op: 'addElement',
      element: { ...rest, id, ...(parentId ? { parentId } : {}) },
    });
  }

  const relationIds = new Set(model.relations.map((r) => r.id));
  const has = (type: string, s: Id, t: Id) =>
    model.relations.some((r) => r.type === type && r.sourceId === s && r.targetId === t);
  for (const r of candidates.relations) {
    const sourceId = idFor.get(r.sourceId);
    const targetId = idFor.get(r.targetId);
    if (!sourceId || !targetId || has(r.type, sourceId, targetId)) continue;
    const id = uniqueId(r.id, relationIds);
    relationIds.add(id);
    suggestedOps.push({ op: 'addRelation', relation: { ...r, id, sourceId, targetId } });
  }

  const detectable = options.detectableKinds ?? new Set(candidates.elements.map((e) => e.kind));
  return {
    newInCode: ordered.filter((c) => !matches[c.id]).map((c) => idFor.get(c.id)!),
    // Missing: existing elements tied to code (code paths, or found by an earlier analysis), and
    // others of a kind this run detects at all.
    missingInCode: model.elements
      .filter(
        (e) =>
          e.status === 'existing' &&
          !used.has(e.id) &&
          (Boolean(e.codePaths?.length) ||
            e.source?.origin === 'inferred' ||
            detectable.has(e.kind)),
      )
      .map((e) => e.id),
    changed,
    suggestedOps,
    matches,
  };
}

/**
 * The suggested ops to apply: all, or the listed element and relation IDs, at or above a
 * confidence. Children of skipped new elements and relations to skipped elements are left
 * out too. `reviewed` marks what a person accepted (the review panel) as opposed to an
 * unattended `analyze --write`.
 */
export function selectSuggestions(
  diff: AnalysisDiff,
  options: { accept?: 'all' | readonly Id[]; minConfidence?: number; reviewed?: boolean } = {},
): ModelOp[] {
  const min = options.minConfidence ?? 0;
  const accept =
    options.accept === undefined || options.accept === 'all' ? null : new Set(options.accept);
  const kept = new Set<Id>();
  const confident = (s: Element['source'] | Relation['source']) => (s?.confidence ?? 1) >= min;
  const review = <T extends Element | Relation>(item: T): T =>
    options.reviewed && item.source
      ? { ...item, source: { ...item.source, reviewed: true } }
      : item;
  const out: ModelOp[] = [];
  const newIds = new Set(
    diff.suggestedOps.flatMap((o) => (o.op === 'addElement' ? [o.element.id] : [])),
  );
  for (const op of diff.suggestedOps) {
    if (op.op === 'addElement') {
      const e = op.element;
      if (accept && !accept.has(e.id)) continue;
      if (!confident(e.source)) continue;
      if (e.parentId && newIds.has(e.parentId) && !kept.has(e.parentId)) continue;
      kept.add(e.id);
      out.push({ op: 'addElement', element: review(e) });
    } else if (op.op === 'addRelation') {
      const r = op.relation;
      if (accept && !accept.has(r.id) && !(accept.has(r.sourceId) && accept.has(r.targetId)))
        continue;
      if (!confident(r.source)) continue;
      const ok = (id: Id) => !newIds.has(id) || kept.has(id);
      if (!ok(r.sourceId) || !ok(r.targetId)) continue;
      out.push({ op: 'addRelation', relation: review(r) });
    } else if (op.op === 'updateElement') {
      if (accept && !accept.has(op.id)) continue;
      out.push(op);
    }
  }
  return out;
}
