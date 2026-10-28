import { Document } from 'yaml';
import { shapeOf } from '../catalog';
import type { ShapeId } from '../catalog';
import type { Element, Id, Relation } from '../schema';
import { invariants, knownIssues, ownership, patterns } from './facts';
import type { Facts } from './facts';

/** `architecture.yaml`: the compact agent format; relations are tuples (§18.3). */
export function agentYaml(f: Facts): string {
  const owners = new Map(ownership(f).map((o) => [o.storeId, o]));
  const element = (e: Element) => {
    const owner = owners.get(e.id);
    return {
      id: e.id,
      kind: e.kind,
      name: e.name,
      ...(e.parentId ? { parent: e.parentId } : {}),
      ...(f.graph.layerOf(e.id) ? { layer: f.graph.layerOf(e.id) } : {}),
      ...(e.tech ? { tech: e.tech } : {}),
      ...(e.responsibilities?.length ? { does: e.responsibilities } : {}),
      ...(e.codePaths?.length ? { code: e.codePaths } : {}),
      ...(owner?.owners.length === 1 ? { ownedBy: owner.owners[0] } : {}),
    };
  };
  const relation = (r: Relation) => {
    const props: Record<string, unknown> = {
      ...(r.protocol ? { protocol: r.protocol } : {}),
      ...(r.label ? { label: r.label } : {}),
      ...(r.via ? { via: r.via } : {}),
      ...(r.mode ? { mode: r.mode } : {}),
      ...(r.inTransaction ? { inTransaction: true } : {}),
      ...(r.properties ?? {}),
    };
    return Object.keys(props).length
      ? [r.sourceId, r.type, r.targetId, props]
      : [r.sourceId, r.type, r.targetId];
  };
  const data = {
    archguide: 1,
    project: f.project.id,
    profile: f.project.profile,
    ...(patterns(f.project).length ? { patterns: patterns(f.project) } : {}),
    revision: f.project.revision,
    elements: f.elements.map(element),
    relations: f.relations.map(relation),
    invariants: invariants(f).map((i) => `${i.text} (${i.source})`),
    known_issues: knownIssues(f).map((i) => ({
      rule: i.ruleId,
      targets: i.targetIds,
      status: i.status,
      reason: i.reason,
    })),
  };
  const doc = new Document(data);
  // One line per element, relation and issue keeps the file short and diff-friendly.
  for (const key of ['elements', 'relations', 'known_issues']) {
    const seq = doc.get(key, true) as { items?: { flow?: boolean }[] } | undefined;
    for (const item of seq?.items ?? []) item.flow = true;
  }
  return doc.toString({ lineWidth: 0 });
}

// --- Mermaid -----------------------------------------------------------------------------

/** Mermaid node IDs: letters, digits and "_" ("svc.orders-api" → "svc__orders_api"). */
const mid = (id: string) => id.replace(/\./g, '__').replace(/-/g, '_');
const mlabel = (text: string) => text.replace(/"/g, '#quot;');

const MERMAID_SHAPES: Record<ShapeId, [string, string]> = {
  actor: ['([', '])'],
  cloud: ['(', ')'],
  octagon: ['{{', '}}'],
  diamond: ['{', '}'],
  cylinder: ['[(', ')]'],
  'cylinder-dashed': ['[(', ')]'],
  pipe: ['>', ']'],
  gear: ['[[', ']]'],
  container: ['[', ']'],
  rect: ['[', ']'],
  window: ['[', ']'],
  rounded: ['(', ')'],
  plug: ['[[', ']]'],
  hexagon: ['{{', '}}'],
  'hexagon-sm': ['{{', '}}'],
  circle: ['((', '))'],
  triangle: ['[/', '\\]'],
  document: ['[', ']'],
};

/** A Mermaid flowchart: containers become subgraphs, async relations dotted (§18.7). */
export function mermaid(
  f: Facts,
  /** Change-set overlay: classes for added, changed and removed items. */
  marks?: { added: readonly Id[]; changed: readonly Id[]; removed?: readonly Id[] },
): string {
  const lines = ['flowchart LR'];
  const included = new Set(f.elements.map((e) => e.id));
  const children = (id: string) =>
    f.elements.filter((e) => e.parentId === id).sort((a, b) => (a.id < b.id ? -1 : 1));
  const node = (e: Element, indent: string) => {
    const kids = children(e.id);
    const concept = f.catalog.concepts.get(e.kind);
    if (kids.length > 0 || concept?.category === 'group') {
      lines.push(`${indent}subgraph ${mid(e.id)}["${mlabel(e.name)}"]`);
      for (const k of kids) node(k, `${indent}  `);
      lines.push(`${indent}end`);
      return;
    }
    const [open, close] = MERMAID_SHAPES[concept ? shapeOf(concept) : 'rect'];
    const sub = concept ? `<br/><small>${mlabel(concept.name)}</small>` : '';
    lines.push(`${indent}${mid(e.id)}${open}"${mlabel(e.name)}${sub}"${close}`);
  };
  const tops = f.elements
    .filter((e) => !e.parentId || !included.has(e.parentId))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const e of tops) node(e, '  ');
  for (const r of f.relations) {
    const type = f.catalog.relationTypes.get(r.type);
    const mode = r.mode ?? type?.mode;
    const arrow = mode === 'async' ? '-.->' : r.type === 'writes' ? '==>' : '-->';
    const text = [type?.name ?? r.type, r.label].filter(Boolean).join(': ');
    lines.push(`  ${mid(r.sourceId)} ${arrow}|"${mlabel(text)}"| ${mid(r.targetId)}`);
  }
  if (marks) {
    const shown = (ids: readonly Id[] = []) => ids.filter((id) => included.has(id)).map(mid);
    const classes: [string, string, readonly Id[] | undefined][] = [
      ['added', 'stroke:#16a34a,stroke-width:3px', marks.added],
      ['changed', 'stroke:#d97706,stroke-width:3px', marks.changed],
      ['removed', 'stroke:#dc2626,stroke-dasharray:4 3', marks.removed],
    ];
    for (const [name, style, ids] of classes) {
      if (!shown(ids).length) continue;
      lines.push(`  classDef ${name} ${style}`, `  class ${shown(ids).join(',')} ${name}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// --- DBML ----------------------------------------------------------------------------------

interface Column {
  name: string;
  type: string;
  nullable?: boolean;
}
interface ForeignKey {
  columns: string[];
  references: string;
  refColumns: string[];
}

const dbmlName = (s: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '')}"`;

/** DBML of the PostgreSQL tables that have columns (§18.7), with owners as notes. */
export function dbml(f: Facts): string {
  const g = f.graph;
  const tables = f.elements.filter((e) => g.is(e, 'pg.table'));
  const qualified = (t: Element) => {
    const schema = g.nearest(t.id, 'pg.schema');
    return `${schema ? `${dbmlName(schema.name)}.` : ''}${dbmlName(t.name)}`;
  };
  const owners = new Map(ownership(f).map((o) => [o.storeId, o]));
  const out: string[] = [
    `// ${f.project.name}: generated by ArchitectureGuide from ${f.project.id} (revision ${f.project.revision}).`,
  ];
  const refs: string[] = [];
  for (const t of tables) {
    const columns = (t.properties?.columns as Column[] | undefined) ?? [];
    if (columns.length === 0) {
      out.push(`// ${qualified(t)}: no columns in the model yet.`);
      continue;
    }
    const pk = new Set((t.properties?.primaryKey as string[] | undefined) ?? []);
    const schema = g.nearest(t.id, 'pg.schema');
    const owner = schema && owners.get(schema.id);
    out.push('', `Table ${qualified(t)} {`);
    for (const c of columns) {
      const settings = [
        ...(pk.size === 1 && pk.has(c.name) ? ['pk'] : []),
        ...(c.nullable === false && !pk.has(c.name) ? ['not null'] : []),
      ];
      out.push(
        `  ${dbmlName(c.name)} ${c.type}${settings.length ? ` [${settings.join(', ')}]` : ''}`,
      );
    }
    const indexes =
      (t.properties?.indexes as { columns: string[]; unique?: boolean }[] | undefined) ?? [];
    if (pk.size > 1 || indexes.length) {
      out.push('', '  indexes {');
      if (pk.size > 1) out.push(`    (${[...pk].join(', ')}) [pk]`);
      for (const i of indexes)
        out.push(`    (${i.columns.join(', ')})${i.unique ? ' [unique]' : ''}`);
      out.push('  }');
    }
    if (owner?.writers.length) out.push(`  Note: 'Written by ${owner.writers.join(', ')}'`);
    out.push('}');
    for (const fk of (t.properties?.foreignKeys as ForeignKey[] | undefined) ?? []) {
      const target = g.element(fk.references);
      const targetName = target ? qualified(target) : dbmlName(fk.references);
      fk.columns.forEach((col, i) =>
        refs.push(
          `Ref: ${qualified(t)}.${dbmlName(col)} > ${targetName}.${dbmlName(fk.refColumns[i] ?? 'id')}`,
        ),
      );
    }
  }
  if (refs.length) out.push('', ...refs);
  return `${out.join('\n')}\n`;
}
