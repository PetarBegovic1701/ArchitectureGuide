import { CATEGORIES } from './shapes';
import { CORE_CONCEPTS } from './core-concepts';
import { CORE_RELATION_RULES, CORE_RELATION_TYPES } from './core-relations';
import { isDenyRule } from './types';
import type {
  AllowRule,
  Concept,
  ConceptGuide,
  ConceptLink,
  DenyRule,
  RelationRule,
  RelationType,
  Selector,
  ShapeId,
  StackProfile,
} from './types';

export interface Catalog {
  readonly profiles: readonly StackProfile[];
  readonly concepts: ReadonlyMap<string, Concept>;
  readonly relationTypes: ReadonlyMap<string, RelationType>;
  /** Real-world uses and typical connections per concept ID. */
  readonly guides: ReadonlyMap<string, ConceptGuide>;
  readonly allowRules: readonly AllowRule[];
  /** Profile deny rules first, then core deny rules. */
  readonly denyRules: readonly DenyRule[];
}

export class CatalogError extends Error {}

/** Builds the catalog from the core concepts and the given profiles. */
export function createCatalog(profiles: readonly StackProfile[] = []): Catalog {
  const concepts = new Map<string, Concept>();
  const relationTypes = new Map<string, RelationType>();
  const prefixes = new Map<string, string>();
  const guides = new Map<string, ConceptGuide>();

  const addConcept = (c: Concept) => {
    if (concepts.has(c.id)) throw new CatalogError(`Duplicate concept "${c.id}"`);
    const owner = prefixes.get(c.idPrefix);
    if (owner) throw new CatalogError(`ID prefix "${c.idPrefix}" used by "${owner}" and "${c.id}"`);
    concepts.set(c.id, c);
    prefixes.set(c.idPrefix, c.id);
  };
  const addType = (t: RelationType) => {
    if (relationTypes.has(t.id)) throw new CatalogError(`Duplicate relation type "${t.id}"`);
    relationTypes.set(t.id, t);
  };

  CORE_CONCEPTS.forEach(addConcept);
  CORE_RELATION_TYPES.forEach(addType);
  const rules: RelationRule[] = [];
  for (const profile of profiles) {
    profile.concepts.forEach(addConcept);
    profile.relationTypes.forEach(addType);
    rules.push(...profile.relationRules);
    for (const [id, guide] of Object.entries(profile.guides ?? {})) {
      if (guides.has(id)) throw new CatalogError(`Duplicate guide for "${id}"`);
      guides.set(id, guide);
    }
  }
  rules.push(...CORE_RELATION_RULES);

  return {
    profiles,
    concepts,
    relationTypes,
    guides,
    allowRules: rules.filter((r): r is AllowRule => !isDenyRule(r)),
    denyRules: rules.filter(isDenyRule),
  };
}

export function shapeOf(concept: Concept): ShapeId {
  return concept.shape ?? CATEGORIES[concept.category].shape;
}

/** True when `selector` selects `concept` (see `Selector`). "top" never matches a concept. */
export function matchSelector(selector: Selector, concept: Concept): boolean {
  if (selector === '*') return true;
  if (selector === 'top') return false;
  if (selector.startsWith('category:')) return concept.category === selector.slice(9);
  if (selector.startsWith('group:')) return concept.palette.group === selector.slice(6);
  if (selector.endsWith('.*')) return concept.id.startsWith(selector.slice(0, -1));
  return concept.id === selector;
}

const matchesAny = (selectors: readonly Selector[] | undefined, concept: Concept) =>
  selectors === undefined || selectors.some((s) => matchSelector(s, concept));

const typeMatches = (ruleType: string | string[], type: string) =>
  ruleType === '*' || ruleType === type || (Array.isArray(ruleType) && ruleType.includes(type));

function denyRuleFor(catalog: Catalog, type: string, source: Concept, target: Concept) {
  return catalog.denyRules.find(
    (r) =>
      typeMatches(r.type, type) && matchesAny(r.deny.from, source) && matchesAny(r.deny.to, target),
  );
}

/** Lowest priority of the allow rules that allow `type` for this pair, or undefined if none do. */
function allowPriority(
  catalog: Catalog,
  type: RelationType,
  source: Concept,
  target: Concept,
  self: boolean,
): number | undefined {
  let best: number | undefined;
  for (const rule of catalog.allowRules) {
    if (!typeMatches(rule.type, type.id)) continue;
    if (self && !rule.allowSelf) continue;
    if (!matchesAny(rule.from, source) || !matchesAny(rule.to, target)) continue;
    const p = rule.priority ?? type.defaultPriority;
    best = best === undefined ? p : Math.min(best, p);
  }
  return best;
}

/**
 * Relation types valid from `sourceKind` to `targetKind`, best first (Implementation.md §10.5).
 * Unknown kinds give an empty list.
 */
export function validRelationTypes(
  catalog: Catalog,
  sourceKind: string,
  targetKind: string,
  options: { self?: boolean } = {},
): RelationType[] {
  const source = catalog.concepts.get(sourceKind);
  const target = catalog.concepts.get(targetKind);
  if (!source || !target) return [];
  const ranked: { type: RelationType; priority: number }[] = [];
  for (const type of catalog.relationTypes.values()) {
    if (denyRuleFor(catalog, type.id, source, target)) continue;
    const priority = allowPriority(catalog, type, source, target, options.self ?? false);
    if (priority !== undefined) ranked.push({ type, priority });
  }
  return ranked.sort((a, b) => a.priority - b.priority).map((r) => r.type);
}

export type RelationCheck =
  | { ok: true }
  | {
      ok: false;
      code: 'UNKNOWN_KIND' | 'UNKNOWN_RELATION' | 'RELATION_NOT_ALLOWED' | 'SELF_RELATION';
      message: string;
      /** Valid types for the same pair, best first. */
      alternatives: string[];
      /** When the reversed direction is valid: the best type for it. */
      flip?: string;
    };

/** Types preferred when a refused relation is flipped (a store is read, a queue is consumed). */
const FLIP_PREFERENCE = ['processes', 'consumes', 'reads'];

/** Checks one relation against the hard constraints and explains a refusal. */
export function checkRelation(
  catalog: Catalog,
  type: string,
  sourceKind: string,
  targetKind: string,
  options: { self?: boolean } = {},
): RelationCheck {
  const relType = catalog.relationTypes.get(type);
  if (!relType) {
    return {
      ok: false,
      code: 'UNKNOWN_RELATION',
      message: `Unknown relation type "${type}".`,
      alternatives: [],
    };
  }
  const source = catalog.concepts.get(sourceKind);
  const target = catalog.concepts.get(targetKind);
  if (!source || !target) {
    const missing = source ? targetKind : sourceKind;
    return {
      ok: false,
      code: 'UNKNOWN_KIND',
      message: `Unknown concept "${missing}".`,
      alternatives: [],
    };
  }
  const self = options.self ?? false;
  const valid = validRelationTypes(catalog, sourceKind, targetKind, { self });
  if (valid.some((t) => t.id === type)) return { ok: true };

  const alternatives = valid.map((t) => t.id);
  if (self) {
    return {
      ok: false,
      code: 'SELF_RELATION',
      message: `${source.name} cannot ${relType.name} itself.`,
      alternatives,
    };
  }

  const deny = denyRuleFor(catalog, type, source, target);
  let message = deny
    ? deny.message
    : relType.hint
      ? `${relType.hint} (${source.name} → ${target.name})`
      : `${source.name} cannot ${relType.name} ${target.name}.`;
  if (alternatives.length > 0) message += ` Valid here: ${alternatives.join(', ')}.`;

  const flipped = validRelationTypes(catalog, targetKind, sourceKind).map((t) => t.id);
  const flip = flipped.includes(type)
    ? type
    : (FLIP_PREFERENCE.find((t) => flipped.includes(t)) ?? flipped[0]);
  return {
    ok: false,
    code: 'RELATION_NOT_ALLOWED',
    message,
    alternatives,
    ...(flip ? { flip } : {}),
  };
}

export type NestingCheck =
  { ok: true } | { ok: false; code: 'UNKNOWN_KIND' | 'NESTING_NOT_ALLOWED'; message: string };

/** Checks whether an element of `childKind` may sit inside `parentKind` (null = top level). */
export function checkNesting(
  catalog: Catalog,
  childKind: string,
  parentKind: string | null,
): NestingCheck {
  const child = catalog.concepts.get(childKind);
  if (!child)
    return { ok: false, code: 'UNKNOWN_KIND', message: `Unknown concept "${childKind}".` };
  if (parentKind === null) {
    if (child.allowedParents.includes('top') || child.allowedParents.includes('*'))
      return { ok: true };
    return {
      ok: false,
      code: 'NESTING_NOT_ALLOWED',
      message:
        child.nestingHint ??
        `${child.name} must be placed inside ${describeParents(catalog, child)}.`,
    };
  }
  const parent = catalog.concepts.get(parentKind);
  if (!parent)
    return { ok: false, code: 'UNKNOWN_KIND', message: `Unknown concept "${parentKind}".` };
  if (child.allowedParents.some((s) => matchSelector(s, parent))) return { ok: true };
  return {
    ok: false,
    code: 'NESTING_NOT_ALLOWED',
    message: child.nestingHint ?? `${child.name} cannot be placed inside ${parent.name}.`,
  };
}

function describeParents(catalog: Catalog, child: Concept): string {
  const names = [...catalog.concepts.values()]
    .filter((c) => child.allowedParents.some((s) => matchSelector(s, c)))
    .map((c) => c.name);
  return names.length > 0 ? names.join(' or ') : 'a parent';
}

export interface PairExplanation {
  /** Valid relation types, best first. Empty when the pair cannot be connected. */
  allowed: RelationType[];
  /** Why nothing is allowed. Empty string when something is allowed. */
  message: string;
  /** The best relation type for the reversed direction, when that direction is valid. */
  flip?: string;
}

/**
 * Explains a drag from one concept to another (Implementation.md §10.5). When no type is
 * allowed, the message comes from the deny rule that best matches what the user probably
 * meant, in this order: a type an allow rule accepts but a deny rule blocks; a type that is
 * valid in the reverse direction (the arrow was drawn backwards); `calls` (the usual intent
 * of an arrow); a rule for every type. Otherwise the message is generic.
 */
export function explainPair(
  catalog: Catalog,
  sourceKind: string,
  targetKind: string,
): PairExplanation {
  const allowed = validRelationTypes(catalog, sourceKind, targetKind);
  if (allowed.length > 0) return { allowed, message: '' };
  const source = catalog.concepts.get(sourceKind);
  const target = catalog.concepts.get(targetKind);
  if (!source || !target)
    return { allowed, message: `Unknown concept "${source ? targetKind : sourceKind}".` };

  const types = [...catalog.relationTypes.values()].sort(
    (a, b) => a.defaultPriority - b.defaultPriority,
  );
  const deniedButAllowed = types.find(
    (t) =>
      allowPriority(catalog, t, source, target, false) !== undefined &&
      denyRuleFor(catalog, t.id, source, target),
  );
  const matching = (pred: (r: DenyRule) => boolean) =>
    catalog.denyRules.find(
      (r) => pred(r) && matchesAny(r.deny.from, source) && matchesAny(r.deny.to, target),
    );
  const flipped = validRelationTypes(catalog, targetKind, sourceKind).map((t) => t.id);
  const backwards = flipped.map((t) => denyRuleFor(catalog, t, source, target)).find(Boolean);
  const deny =
    (deniedButAllowed && denyRuleFor(catalog, deniedButAllowed.id, source, target)) ||
    backwards ||
    matching((r) => typeMatches(r.type, 'calls') && r.type !== '*') ||
    matching((r) => r.type === '*');

  const flip = FLIP_PREFERENCE.find((t) => flipped.includes(t)) ?? flipped[0];
  let message = deny?.message ?? `${source.name} cannot be connected to ${target.name}.`;
  if (flip)
    message += ` Reverse it: ${target.name} ${catalog.relationTypes.get(flip)!.name} ${source.name}.`;
  return { allowed, message, ...(flip ? { flip } : {}) };
}

/**
 * Problems in the concept guides: unknown concepts or relation types, and typical
 * connections that the relation rules refuse. Profiles test that this is empty.
 */
export function checkGuides(catalog: Catalog): string[] {
  const problems: string[] = [];
  for (const [id, guide] of catalog.guides) {
    if (!catalog.concepts.has(id)) problems.push(`Guide for unknown concept "${id}"`);
    for (const link of guide.connections) {
      const where = `${id} ${link.direction === 'out' ? '→' : '←'} ${link.type} ${link.kind}`;
      if (!catalog.concepts.has(link.kind)) problems.push(`${where}: unknown concept`);
      else if (!catalog.relationTypes.has(link.type))
        problems.push(`${where}: unknown relation type`);
      else {
        // Two elements of the same concept (route → route) are fine; `self` is one element.
        const [from, to] = link.direction === 'out' ? [id, link.kind] : [link.kind, id];
        if (!validRelationTypes(catalog, from, to).some((t) => t.id === link.type))
          problems.push(`${where}: not allowed by the relation rules`);
      }
    }
  }
  return problems;
}

/** One relation type in one direction, and the concepts it can connect to. */
export interface ConnectionGroup {
  direction: ConceptLink['direction'];
  type: RelationType;
  concepts: Concept[];
}

/**
 * What a concept can connect to: the guide's typical connections first, then every other
 * pair the relation rules allow, grouped by direction and relation type (best type first).
 */
export function conceptConnections(
  catalog: Catalog,
  kind: string,
): { typical: ConceptLink[]; other: ConnectionGroup[] } {
  const typical = catalog.guides.get(kind)?.connections ?? [];
  const known = new Set(typical.map((l) => `${l.direction}|${l.type}|${l.kind}`));
  const groups = new Map<string, ConnectionGroup & { rank: number }>();
  const add = (direction: 'out' | 'in', other: Concept, types: RelationType[]) =>
    types.forEach((type, rank) => {
      if (known.has(`${direction}|${type.id}|${other.id}`)) return;
      const key = `${direction}|${type.id}`;
      const group = groups.get(key) ?? { direction, type, concepts: [], rank: Infinity };
      group.concepts.push(other);
      group.rank = Math.min(group.rank, type.defaultPriority + rank);
      groups.set(key, group);
    });
  for (const other of catalog.concepts.values()) {
    add('out', other, validRelationTypes(catalog, kind, other.id));
    // Between two elements of the same concept, "out" already lists the pair.
    if (other.id !== kind) add('in', other, validRelationTypes(catalog, other.id, kind));
  }
  const other = [...groups.values()]
    .sort((a, b) =>
      a.direction === b.direction ? a.rank - b.rank : a.direction === 'out' ? -1 : 1,
    )
    .map(({ direction, type, concepts }) => ({
      direction,
      type,
      concepts: concepts.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  return { typical, other };
}
