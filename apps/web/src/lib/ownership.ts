import { dataOwners } from '@archguide/core';
import type { Id, Project } from '@archguide/core';
import { catalog } from './catalog';

/** Owner colors: distinct, readable in light and dark mode. */
const PALETTE = [
  '#2563eb',
  '#16a34a',
  '#9333ea',
  '#d97706',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#4f46e5',
];
export const SHARED_COLOR = '#dc2626';

export interface OwnershipLegend {
  owners: { id: Id; name: string; color: string; owns: string[] }[];
  shared: { id: Id; name: string; writers: string[] }[];
}

/**
 * Ownership colors for the database view (Implementation.md §19.5): every schema, table
 * and queue takes the color of the deployable that owns it, and so does the owner; data
 * written by someone other than its owner is red.
 */
export function ownershipColors(p: Project): { colors: Map<Id, string>; legend: OwnershipLegend } {
  const owners = dataOwners(p, catalog);
  const name = (id: Id) => p.model.elements.find((e) => e.id === id)?.name ?? id;
  const ownerIds = [
    ...new Set([...owners.values()].flatMap((o) => (o.owner ? [o.owner] : []))),
  ].sort();
  const colorOf = new Map(ownerIds.map((id, i) => [id, PALETTE[i % PALETTE.length]!]));
  const colors = new Map<Id, string>(colorOf);
  const legend: OwnershipLegend = {
    owners: ownerIds.map((id) => ({ id, name: name(id), color: colorOf.get(id)!, owns: [] })),
    shared: [],
  };
  for (const [id, o] of owners) {
    if (o.shared) {
      colors.set(id, SHARED_COLOR);
      legend.shared.push({ id, name: name(id), writers: o.writers.map(name) });
    } else if (o.owner) {
      colors.set(id, colorOf.get(o.owner)!);
      if (p.model.elements.find((e) => e.id === id)?.kind === 'pg.schema')
        legend.owners.find((x) => x.id === o.owner)!.owns.push(name(id));
    }
  }
  return { colors, legend };
}
