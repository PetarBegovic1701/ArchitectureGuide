import { z } from 'zod';
import { matchSelector, validRelationTypes } from '../catalog';
import type { Catalog } from '../catalog';

/**
 * The catalog as plain data for agents (get_catalog, Implementation.md §20.2): concepts with
 * their properties as JSON Schema, relation types, and which types connect which concepts.
 * `filter` is a selector ("react.*", "category:data-at-rest", "group:Backend") or an ID prefix.
 */
export function catalogSummary(catalog: Catalog, filter?: string) {
  const matches = (id: string) => {
    if (!filter) return true;
    const concept = catalog.concepts.get(id)!;
    return filter.includes(':') || filter.endsWith('*')
      ? matchSelector(filter, concept)
      : id.startsWith(filter);
  };
  const concepts = [...catalog.concepts.values()].filter((c) => matches(c.id));
  const schema = (s: unknown) =>
    s ? (z.toJSONSchema(s as z.ZodType, { unrepresentable: 'any' }) as object) : undefined;
  return {
    concepts: concepts.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      group: c.palette.group,
      allowedParents: c.allowedParents,
      docs: c.docs,
      ...(c.propertySchema ? { properties: schema(c.propertySchema) } : {}),
    })),
    relationTypes: [...catalog.relationTypes.values()].map((t) => ({
      id: t.id,
      name: t.name,
      mode: t.mode,
      docs: t.docs,
      ...(t.propertySchema ? { properties: schema(t.propertySchema) } : {}),
    })),
    // Pairs only for a filtered list; the full matrix is large.
    ...(filter
      ? {
          pairs: concepts.flatMap((source) =>
            [...catalog.concepts.values()].flatMap((target) => {
              const types = validRelationTypes(catalog, source.id, target.id).map((t) => t.id);
              return types.length ? [{ from: source.id, to: target.id, types }] : [];
            }),
          ),
        }
      : {}),
  };
}
