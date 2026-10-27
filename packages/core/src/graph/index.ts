import { CATEGORIES } from '../catalog';
import type { Catalog, CategoryId, Concept } from '../catalog';
import { matchSelector } from '../catalog';
import type { Element, Id, Layer, Project, Relation } from '../schema';

/**
 * Read-only queries over a project model, used by rules (Implementation.md §11.2).
 * Built once per rule run; all lookups are indexed.
 */
export class GraphQuery {
  readonly elements: readonly Element[];
  readonly relations: readonly Relation[];
  private readonly byId = new Map<Id, Element>();
  private readonly relById = new Map<Id, Relation>();
  private readonly out = new Map<Id, Relation[]>();
  private readonly into = new Map<Id, Relation[]>();
  private readonly kids = new Map<Id, Element[]>();

  constructor(
    readonly project: Project,
    readonly catalog: Catalog,
  ) {
    this.elements = project.model.elements;
    this.relations = project.model.relations;
    for (const e of this.elements) this.byId.set(e.id, e);
    for (const e of this.elements) {
      if (e.parentId) push(this.kids, e.parentId, e);
    }
    for (const r of this.relations) {
      this.relById.set(r.id, r);
      push(this.out, r.sourceId, r);
      push(this.into, r.targetId, r);
    }
  }

  element(id: Id): Element | undefined {
    return this.byId.get(id);
  }

  relation(id: Id): Relation | undefined {
    return this.relById.get(id);
  }

  concept(el: Element): Concept | undefined {
    return this.catalog.concepts.get(el.kind);
  }

  category(el: Element): CategoryId | undefined {
    return this.concept(el)?.category;
  }

  /** True when the element's concept matches the selector ("node.*", "category:deployable", ...). */
  is(el: Element | undefined, selector: string): boolean {
    const concept = el && this.concept(el);
    return concept !== undefined && matchSelector(selector, concept);
  }

  /** Elements whose concept matches any of the selectors. */
  ofKind(...selectors: string[]): Element[] {
    return this.elements.filter((e) => selectors.some((s) => this.is(e, s)));
  }

  /** Relation types that are `type` or specialize it ("enqueues" counts as "publishes"). */
  typeIs(r: Relation, ...types: string[]): boolean {
    if (types.includes(r.type)) return true;
    const specializes = this.catalog.relationTypes.get(r.type)?.specializes;
    return specializes !== undefined && types.includes(specializes);
  }

  outgoing(id: Id, ...types: string[]): Relation[] {
    const list = this.out.get(id) ?? [];
    return types.length ? list.filter((r) => this.typeIs(r, ...types)) : list;
  }

  incoming(id: Id, ...types: string[]): Relation[] {
    const list = this.into.get(id) ?? [];
    return types.length ? list.filter((r) => this.typeIs(r, ...types)) : list;
  }

  children(id: Id): Element[] {
    return this.kids.get(id) ?? [];
  }

  /** The element itself and everything nested inside it. */
  subtree(id: Id): Element[] {
    const root = this.byId.get(id);
    if (!root) return [];
    const result = [root];
    for (let i = 0; i < result.length; i++) result.push(...this.children(result[i]!.id));
    return result;
  }

  ancestors(id: Id): Element[] {
    const result: Element[] = [];
    for (let cur = this.byId.get(id)?.parentId; cur; cur = this.byId.get(cur)?.parentId) {
      const el = this.byId.get(cur);
      if (!el || result.includes(el)) break;
      result.push(el);
    }
    return result;
  }

  /** The nearest deployable at or above the element: what runs as a process. */
  deployableOf(id: Id): Element | undefined {
    const el = this.byId.get(id);
    if (!el) return undefined;
    return [el, ...this.ancestors(id)].find((e) => this.category(e) === 'deployable');
  }

  /** The nearest element at or above `id` that matches the selector. */
  nearest(id: Id, selector: string): Element | undefined {
    const el = this.byId.get(id);
    if (!el) return undefined;
    return [el, ...this.ancestors(id)].find((e) => this.is(e, selector));
  }

  /** Layer of an element: its own, else its concept's default, else its category's default. */
  layerOf(id: Id): Layer | undefined {
    const el = this.byId.get(id);
    if (!el) return undefined;
    if (el.layer) return el.layer;
    const concept = this.concept(el);
    return (
      concept?.defaultLayer ?? (concept ? CATEGORIES[concept.category].defaultLayer : undefined)
    );
  }

  /** Relations that start at the element or anything inside it. */
  outgoingFromSubtree(id: Id, ...types: string[]): Relation[] {
    return this.subtree(id).flatMap((e) => this.outgoing(e.id, ...types));
  }

  /** Relations that end at the element or anything inside it. */
  incomingToSubtree(id: Id, ...types: string[]): Relation[] {
    return this.subtree(id).flatMap((e) => this.incoming(e.id, ...types));
  }

  /**
   * Strongly connected components with more than one member (or a self loop), following
   * relations of the given types. `map` turns element IDs into graph nodes (for example
   * their deployable) or drops them (undefined); `accept` filters relations. Tarjan's algorithm.
   */
  cycles(
    types: string[],
    map: (id: Id) => Id | undefined = (id) => id,
    accept: (r: Relation) => boolean = () => true,
  ): Id[][] {
    const edges = new Map<Id, Set<Id>>();
    const nodes = new Set<Id>();
    for (const r of this.relations) {
      if (!this.typeIs(r, ...types) || !accept(r)) continue;
      const a = map(r.sourceId);
      const b = map(r.targetId);
      if (!a || !b) continue;
      nodes.add(a);
      nodes.add(b);
      if (!edges.has(a)) edges.set(a, new Set());
      edges.get(a)!.add(b);
    }
    let index = 0;
    const idx = new Map<Id, number>();
    const low = new Map<Id, number>();
    const stack: Id[] = [];
    const onStack = new Set<Id>();
    const result: Id[][] = [];
    const visit = (v: Id) => {
      idx.set(v, index);
      low.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);
      for (const w of edges.get(v) ?? []) {
        if (!idx.has(w)) {
          visit(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, idx.get(w)!));
        }
      }
      if (low.get(v) === idx.get(v)) {
        const component: Id[] = [];
        let w: Id;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== v);
        if (component.length > 1 || edges.get(v)?.has(v)) result.push(component.sort());
      }
    };
    for (const v of [...nodes].sort()) if (!idx.has(v)) visit(v);
    return result;
  }

  /**
   * Longest chain of distinct nodes reachable from `start` along relations of `types`,
   * after mapping element IDs with `map` (for example to their deployable). Cycle-safe.
   */
  longestChain(start: Id, types: string[], map: (id: Id) => Id | undefined = (id) => id): Id[] {
    const next = new Map<Id, Set<Id>>();
    for (const r of this.relations) {
      if (!this.typeIs(r, ...types)) continue;
      const a = map(r.sourceId);
      const b = map(r.targetId);
      if (!a || !b || a === b) continue;
      if (!next.has(a)) next.set(a, new Set());
      next.get(a)!.add(b);
    }
    let best: Id[] = [];
    const walk = (node: Id, path: Id[]) => {
      if (path.length > best.length) best = [...path];
      if (path.length > 50) return;
      for (const n of next.get(node) ?? []) if (!path.includes(n)) walk(n, [...path, n]);
    };
    const first = map(start);
    if (first) walk(first, [first]);
    return best;
  }

  /** Number of distinct elements related to `id` in each direction (relations only, no nesting). */
  degree(id: Id): { in: number; out: number } {
    const ins = new Set(this.incoming(id).map((r) => r.sourceId));
    const outs = new Set(this.outgoing(id).map((r) => r.targetId));
    return { in: ins.size, out: outs.size };
  }

  /** A number property of an element, or a fallback when unset. */
  num(el: Element, key: string, fallback: number): number {
    const v = el.properties?.[key];
    return typeof v === 'number' ? v : fallback;
  }

  /** A string property of an element or relation. */
  str(item: Element | Relation, key: string): string | undefined {
    const v = item.properties?.[key];
    return typeof v === 'string' ? v : undefined;
  }

  /** The element's name, responsibilities and tags as lower-case text, for keyword rules. */
  text(el: Element): string {
    return [el.name, el.description ?? '', ...(el.responsibilities ?? []), ...(el.tags ?? [])]
      .join(' ')
      .toLowerCase();
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
