import { matchSelector } from '../catalog';
import type { Catalog } from '../catalog';
import type { Element, Project, Relation } from '../schema';
import type { Check, ElementMatch, RelationMatch, ValueMatch } from './schema';

export interface CheckContext {
  /** Needed for "category:" and "group:" kind selectors. */
  catalog?: Catalog;
  /** Rule findings for `finding` checks (from the rules engine). */
  findings?: readonly { ruleId: string; targetIds: readonly string[] }[];
}

export interface CheckResult {
  passed: boolean;
  /** Human-readable reasons, one per failing leaf check. Empty when passed. */
  failures: string[];
}

/** Evaluates a check against a project model. Pure; never throws for a valid check. */
export function evaluateCheck(project: Project, check: Check, ctx: CheckContext = {}): CheckResult {
  const failures: string[] = [];
  const passed = evaluate(project, check, ctx, failures);
  return { passed, failures: passed ? [] : failures };
}

function evaluate(p: Project, check: Check, ctx: CheckContext, failures: string[]): boolean {
  const fail = (reason: string) => {
    failures.push(check.message ?? reason);
    return false;
  };

  if ('all' in check) {
    const inner: string[] = [];
    const ok = check.all.map((c) => evaluate(p, c, ctx, inner)).every(Boolean);
    if (!ok) failures.push(...(check.message ? [check.message] : inner));
    return ok;
  }
  if ('any' in check) {
    const inner: string[] = [];
    const ok = check.any.map((c) => evaluate(p, c, ctx, inner)).some(Boolean);
    if (!ok) failures.push(check.message ?? `None of these is true: ${inner.join(' / ')}`);
    return ok;
  }
  if ('not' in check) {
    const ok = !evaluate(p, check.not, ctx, []);
    return ok || fail(`This should not be the case: ${describeCheck(check.not)}`);
  }
  if ('hasElement' in check) {
    const count = p.model.elements.filter((e) =>
      matchesElement(p, e, check.hasElement, ctx),
    ).length;
    return (
      inRange(count, check.min, check.max) ||
      fail(countReason(count, check, describeElement(check.hasElement)))
    );
  }
  if ('hasRelation' in check) {
    const count = p.model.relations.filter((r) =>
      matchesRelation(p, r, check.hasRelation, ctx),
    ).length;
    return (
      inRange(count, check.min, check.max) ||
      fail(countReason(count, check, describeRelation(check.hasRelation)))
    );
  }
  if ('noPath' in check) {
    const { from, to, types } = check.noPath;
    const path = findPath(p, from, to, types, ctx);
    return path === undefined || fail(`There should be no path ${path.join(' → ')}`);
  }
  // finding
  if (!ctx.findings)
    return fail(`Rule ${check.finding.ruleId} cannot be checked without the rules engine`);
  const present = ctx.findings.some((f) => f.ruleId === check.finding.ruleId);
  return (
    present === check.finding.present ||
    fail(
      check.finding.present
        ? `Expected rule ${check.finding.ruleId} to report a problem`
        : `Rule ${check.finding.ruleId} still reports a problem`,
    )
  );
}

export function matchesElement(
  p: Project,
  el: Element,
  m: ElementMatch,
  ctx: CheckContext,
): boolean {
  if (m.id !== undefined && el.id !== m.id) return false;
  if (m.kind !== undefined && !matchesKind(el.kind, m.kind, ctx)) return false;
  if (m.nameIncludes !== undefined && !el.name.toLowerCase().includes(m.nameIncludes.toLowerCase()))
    return false;
  if (m.parent !== undefined) {
    const parent = el.parentId ? p.model.elements.find((e) => e.id === el.parentId) : undefined;
    if (!parent || !matchesElement(p, parent, m.parent, ctx)) return false;
  }
  return matchesWhere(el, m.where);
}

function matchesRelation(p: Project, r: Relation, m: RelationMatch, ctx: CheckContext): boolean {
  if (
    m.type !== undefined &&
    !(Array.isArray(m.type) ? m.type.includes(r.type) : m.type === r.type)
  )
    return false;
  const end = (id: string, match: ElementMatch | undefined) => {
    if (!match) return true;
    const el = p.model.elements.find((e) => e.id === id);
    return el !== undefined && matchesElement(p, el, match, ctx);
  };
  return end(r.sourceId, m.from) && end(r.targetId, m.to) && matchesWhere(r, m.where);
}

function matchesKind(kind: string, selector: string, ctx: CheckContext): boolean {
  if (selector.startsWith('category:') || selector.startsWith('group:')) {
    const concept = ctx.catalog?.concepts.get(kind);
    return concept !== undefined && matchSelector(selector, concept);
  }
  if (selector === '*') return true;
  if (selector.endsWith('.*')) return kind.startsWith(selector.slice(0, -1));
  return kind === selector;
}

function matchesWhere(item: object, where: Record<string, ValueMatch> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([path, match]) => matchesValue(getPath(item, path), match));
}

function getPath(item: object, path: string): unknown {
  let current: unknown = item;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function matchesValue(value: unknown, match: ValueMatch): boolean {
  if (typeof match !== 'object') return value === match;
  if ('in' in match) return match.in.some((m) => m === value);
  if ('exists' in match) return (value !== undefined && value !== null) === match.exists;
  const needle = match.includes.toLowerCase();
  if (typeof value === 'string') return value.toLowerCase().includes(needle);
  if (Array.isArray(value))
    return value.some((v) => typeof v === 'string' && v.toLowerCase() === needle);
  return false;
}

/** Breadth-first search along relations (source → target). Returns the first path found as element IDs. */
function findPath(
  p: Project,
  from: ElementMatch,
  to: ElementMatch,
  types: string[] | undefined,
  ctx: CheckContext,
): string[] | undefined {
  const byId = new Map(p.model.elements.map((e) => [e.id, e]));
  const starts = p.model.elements.filter((e) => matchesElement(p, e, from, ctx));
  for (const start of starts) {
    const previous = new Map<string, string | null>([[start.id, null]]);
    const queue = [start.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const r of p.model.relations) {
        if (r.sourceId !== current || previous.has(r.targetId)) continue;
        if (types && !types.includes(r.type)) continue;
        previous.set(r.targetId, current);
        const target = byId.get(r.targetId);
        if (target && matchesElement(p, target, to, ctx)) {
          const path = [r.targetId];
          for (let id = previous.get(r.targetId); id; id = previous.get(id)) path.unshift(id);
          return path;
        }
        queue.push(r.targetId);
      }
    }
  }
  return undefined;
}

function inRange(count: number, min = 1, max?: number): boolean {
  return count >= min && (max === undefined || count <= max);
}

function countReason(count: number, c: { min?: number; max?: number }, what: string): string {
  const min = c.min ?? 1;
  if (c.max !== undefined && count > c.max)
    return `Expected at most ${c.max} ${what}, found ${count}`;
  const amount = min === 1 ? 'at least one' : `at least ${min}`;
  return `Expected ${amount} ${what}, found ${count}`;
}

export function describeElement(m: ElementMatch): string {
  const parts: string[] = [];
  if (m.kind) parts.push(m.kind);
  if (m.id) parts.push(`"${m.id}"`);
  if (m.nameIncludes) parts.push(`named like "${m.nameIncludes}"`);
  if (m.parent) parts.push(`inside ${describeElement(m.parent)}`);
  if (m.where) parts.push(describeWhere(m.where));
  return parts.length ? `element (${parts.join(', ')})` : 'element';
}

function describeRelation(m: RelationMatch): string {
  const type =
    m.type === undefined
      ? 'relation'
      : `"${Array.isArray(m.type) ? m.type.join('" or "') : m.type}" relation`;
  const from = m.from ? ` from ${describeElement(m.from)}` : '';
  const to = m.to ? ` to ${describeElement(m.to)}` : '';
  const where = m.where ? ` with ${describeWhere(m.where)}` : '';
  return `${type}${from}${to}${where}`;
}

function describeWhere(where: Record<string, ValueMatch>): string {
  return Object.entries(where)
    .map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : `= ${String(v)}`}`)
    .join(', ');
}

function describeCheck(c: Check): string {
  if ('hasElement' in c) return `there is an ${describeElement(c.hasElement)}`;
  if ('hasRelation' in c) return `there is a ${describeRelation(c.hasRelation)}`;
  return c.message ?? 'the inner condition holds';
}
