import type { ZodType } from 'zod';
import type { Catalog } from '../catalog';
import { checkNesting, checkRelation } from '../catalog';
import { makeElementId, makeRelationId } from '../ids';
import type { AntiPattern, Element, Evidence, Id, Model, Relation } from '../schema';
import type { Fact } from './types';

/** Evidence kept per candidate; more is noise in the review panel. */
const MAX_EVIDENCE = 8;

/** Noisy-or over the facts' confidences, capped at 0.99 (§19.6). */
export function combineConfidence(values: readonly number[]): number {
  const miss = values.reduce((p, c) => p * (1 - Math.min(Math.max(c, 0), 1)), 1);
  return Math.round(Math.min(0.99, 1 - miss) * 1000) / 1000;
}

function mergeEvidence(facts: readonly Fact[]): Evidence[] {
  const seen = new Map<string, Evidence>();
  for (const f of facts)
    for (const e of f.evidence) {
      const key = `${e.path}:${e.line ?? ''}`;
      if (!seen.has(key)) seen.set(key, { ...e, detector: e.detector ?? f.detector });
    }
  return [...seen.values()]
    .sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0))
    .slice(0, MAX_EVIDENCE);
}

/**
 * Keeps only properties the schema accepts (a detector may read a value the concept does not
 * know); the dropped keys are reported.
 */
function validProperties(
  schema: ZodType | undefined,
  properties: Record<string, unknown>,
  where: string,
  warnings: string[],
): Record<string, unknown> {
  if (!schema || Object.keys(properties).length === 0) return properties;
  const kept = { ...properties };
  for (let i = 0; i < 5; i++) {
    const r = schema.safeParse(kept);
    if (r.success) return kept;
    const keys = new Set(
      r.error.issues.map((x) => String(x.path[0] ?? '')).filter((k) => k in kept),
    );
    if (keys.size === 0) return {};
    for (const k of keys) {
      warnings.push(`${where}: property "${k}" dropped (${String(kept[k])} is not valid)`);
      delete kept[k];
    }
  }
  return {};
}

/** Key under which a rejected relation is remembered (`.archguide/analysis/rejected.json`). */
export const relationSubject = (type: string, from: string, to: string) =>
  `rel:${type}:${from}->${to}`;

export interface Resolved {
  candidates: Model;
  /** Fact subject → candidate element ID. */
  subjects: Record<string, Id>;
  warnings: string[];
}

/**
 * Facts → candidate elements and relations (§19.6): one element per subject, the kind and
 * name of the most confident fact, merged code paths, properties and evidence, and a
 * noisy-or confidence. Parents come from the facts; an element whose parent is missing or
 * not allowed goes to the top level when it may. Otherwise it stays in the parent the code
 * gives it, with an anti-pattern mark, and it is dropped only when it has no parent. A
 * relation the rules refuse is kept with an anti-pattern mark too: the draft shows the code
 * as it is, and rule AP-019 reports what to address.
 */
export function resolveFacts(
  facts: readonly Fact[],
  catalog: Catalog,
  options: { rejected?: ReadonlySet<string> } = {},
): Resolved {
  const rejected = options.rejected ?? new Set<string>();
  const warnings: string[] = [];
  const bySubject = new Map<string, Fact[]>();
  for (const f of facts) {
    if (!f.element || rejected.has(f.subject)) continue;
    const list = bySubject.get(f.subject) ?? [];
    list.push(f);
    bySubject.set(f.subject, list);
  }

  // Parents before children, then by subject, so IDs do not depend on detector order.
  const parentOf = (subject: string) => {
    const list = bySubject.get(subject) ?? [];
    return [...list].sort((a, b) => b.confidence - a.confidence).find((f) => f.element?.parent)
      ?.element?.parent;
  };
  const depth = (subject: string, seen = new Set<string>()): number => {
    const parent = parentOf(subject);
    if (!parent || seen.has(parent) || !bySubject.has(parent)) return 0;
    seen.add(subject);
    return 1 + depth(parent, seen);
  };
  const order = [...bySubject.keys()].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));

  const subjects: Record<string, Id> = {};
  const elements: Element[] = [];
  const taken = new Set<Id>();
  for (const subject of order) {
    const list = [...bySubject.get(subject)!].sort((a, b) => b.confidence - a.confidence);
    const main = list[0]!.element!;
    const concept = catalog.concepts.get(main.kind);
    if (!concept) {
      warnings.push(`${subject}: unknown concept "${main.kind}"`);
      continue;
    }
    let parentId: Id | undefined;
    let antiPattern: AntiPattern | undefined;
    const parentSubject = parentOf(subject);
    const parent =
      parentSubject && subjects[parentSubject]
        ? elements.find((e) => e.id === subjects[parentSubject])
        : undefined;
    if (parent && checkNesting(catalog, main.kind, parent.kind).ok) parentId = parent.id;
    if (!parentId && !checkNesting(catalog, main.kind, null).ok) {
      if (!parent) {
        warnings.push(`${subject}: a ${concept.name} needs a parent; dropped`);
        continue;
      }
      // The code puts it where the rules do not allow it: keep it there, marked (AP-019).
      parentId = parent.id;
      antiPattern = {
        note: `The code has the ${concept.name.toLowerCase()} ${main.name} inside ${parent.name}`,
        violates: (checkNesting(catalog, main.kind, parent.kind) as { message: string }).message,
        evidence: mergeEvidence(list).slice(0, 3),
      };
    }
    const codePaths = [...new Set(list.flatMap((f) => f.element?.codePaths ?? []))].sort();
    const properties = validProperties(
      concept.propertySchema,
      Object.assign({}, ...[...list].reverse().map((f) => f.element?.properties ?? {})) as Record<
        string,
        unknown
      >,
      subject,
      warnings,
    );
    const tech = list.find((f) => f.element?.tech)?.element?.tech;
    const layer = list.find((f) => f.element?.layer)?.element?.layer;
    const id = makeElementId(concept.idPrefix, main.name, taken);
    taken.add(id);
    subjects[subject] = id;
    elements.push({
      id,
      kind: main.kind,
      name: main.name,
      status: 'existing',
      ...(parentId ? { parentId } : {}),
      ...(tech ? { tech } : {}),
      ...(layer ? { layer: layer as Element['layer'] } : {}),
      ...(codePaths.length ? { codePaths } : {}),
      ...(Object.keys(properties).length ? { properties } : {}),
      ...(antiPattern ? { antiPattern } : {}),
      source: {
        origin: 'inferred',
        confidence: combineConfidence(list.map((f) => f.confidence)),
        evidence: mergeEvidence(list),
        reviewed: false,
      },
    });
  }

  const kindOf = new Map(elements.map((e) => [e.id, e.kind]));
  const byKey = new Map<string, Fact[]>();
  for (const f of facts) {
    const r = f.relation;
    if (!r || rejected.has(relationSubject(r.type, r.from, r.to))) continue;
    const key = `${r.type}|${r.from}|${r.to}`;
    byKey.set(key, [...(byKey.get(key) ?? []), f]);
  }
  const relations: Relation[] = [];
  const relationIds = new Set<Id>();
  const refused = new Set<string>();
  const nameOf = (id: Id) => elements.find((e) => e.id === id)?.name ?? id;
  for (const key of [...byKey.keys()].sort()) {
    const list = [...byKey.get(key)!].sort((a, b) => b.confidence - a.confidence);
    const r = list[0]!.relation!;
    const sourceId = subjects[r.from];
    const targetId = subjects[r.to];
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const check = checkRelation(catalog, r.type, kindOf.get(sourceId)!, kindOf.get(targetId)!);
    let antiPattern: AntiPattern | undefined;
    if (!check.ok && check.code === 'RELATION_NOT_ALLOWED') {
      // The code does what the rules forbid: keep it, marked, so the model stays faithful.
      antiPattern = {
        note:
          list.find((f) => f.relation?.antiPattern)?.relation?.antiPattern ??
          `The code has ${nameOf(sourceId)} ${r.type} ${nameOf(targetId)}`,
        violates: check.message,
        evidence: mergeEvidence(list).slice(0, 3),
      };
    } else if (!check.ok) {
      const note = `${kindOf.get(sourceId)} -${r.type}-> ${kindOf.get(targetId)}`;
      if (!refused.has(note)) warnings.push(`relation not allowed, skipped: ${note}`);
      refused.add(note);
      continue;
    } else {
      const flagged = list.find((f) => f.relation?.antiPattern)?.relation?.antiPattern;
      if (flagged) antiPattern = { note: flagged, evidence: mergeEvidence(list).slice(0, 3) };
    }
    const id = makeRelationId(sourceId, r.type, targetId, relationIds);
    relationIds.add(id);
    const pick = <K extends keyof typeof r>(k: K) =>
      list.find((f) => f.relation?.[k] !== undefined)?.relation?.[k];
    const label = pick('label');
    const protocol = pick('protocol');
    const via = pick('via');
    const inTransaction = list.some((f) => f.relation?.inTransaction) ? true : undefined;
    const properties = validProperties(
      catalog.relationTypes.get(r.type)?.propertySchema,
      Object.assign({}, ...list.map((f) => f.relation?.properties ?? {})) as Record<
        string,
        unknown
      >,
      key,
      warnings,
    );
    relations.push({
      id,
      type: r.type,
      sourceId,
      targetId,
      status: 'existing',
      ...(label ? { label: label as string } : {}),
      ...(protocol ? { protocol: protocol as string } : {}),
      ...(via ? { via: via as string } : {}),
      ...(inTransaction ? { inTransaction } : {}),
      ...(Object.keys(properties).length ? { properties } : {}),
      ...(antiPattern ? { antiPattern } : {}),
      source: {
        origin: 'inferred',
        confidence: combineConfidence(list.map((f) => f.confidence)),
        evidence: mergeEvidence(list),
        reviewed: false,
      },
    });
  }
  return { candidates: { elements, relations }, subjects, warnings };
}
