import type { Evidence } from '../schema';
import type { Fact } from './types';

export interface TableUsage {
  /** Subject of the deployable that uses the table. */
  deployable: string;
  orm?: string;
  evidence: Evidence[];
}

export interface Ownership {
  /** Per table subject: its schema subject and who reads and writes it. */
  tables: Record<string, { schema: string; readers: TableUsage[]; writers: TableUsage[] }>;
  /** Per schema subject: the packages whose migrations touch it, and the deployables that write it. */
  schemas: Record<string, { owners: TableUsage[]; writers: string[] }>;
  /** ORM usages whose model or table no schema fact knows. */
  unresolved: { deployable: string; target: string; evidence: Evidence[] }[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Data ownership (Implementation.md §19.5). `orm-usage` facts (data: deployable, target,
 * op 'read' | 'write', orm) are resolved to tables through the `db-table` facts (data:
 * schema, table, model). `migrations` facts (data: deployable, tables?, schemas?, tool) give
 * the schema owners. Returns the ownership map and the `reads`, `writes` and `migrates`
 * relation facts it implies.
 */
export function dataOwnership(facts: readonly Fact[]): { ownership: Ownership; facts: Fact[] } {
  const tables = facts.filter((f) => f.type === 'db-table');
  const lookup = new Map<string, Fact>();
  for (const t of tables) {
    const d = t.data as { table?: string; model?: string; schema?: string };
    for (const key of [
      d.model,
      d.table,
      d.schema && d.table ? `${d.schema}.${d.table}` : undefined,
    ])
      if (key && !lookup.has(norm(key))) lookup.set(norm(key), t);
  }
  const schemaOf = (t: Fact) => t.element?.parent ?? `schema:${String(t.data.schema ?? 'public')}`;

  const ownership: Ownership = { tables: {}, schemas: {}, unresolved: [] };
  const out: Fact[] = [];
  const usage = new Map<string, { read: Fact[]; write: Fact[] }>();
  for (const f of facts.filter((x) => x.type === 'orm-usage')) {
    const d = f.data as { deployable: string; target: string; op: 'read' | 'write'; orm?: string };
    const table = lookup.get(norm(d.target));
    if (!table) {
      ownership.unresolved.push({
        deployable: d.deployable,
        target: d.target,
        evidence: f.evidence,
      });
      continue;
    }
    const key = `${d.deployable}|${table.subject}`;
    const entry = usage.get(key) ?? { read: [], write: [] };
    entry[d.op].push(f);
    usage.set(key, entry);
  }
  for (const [key, u] of [...usage.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [deployable, tableSubject] = key.split('|') as [string, string];
    const table = tables.find((t) => t.subject === tableSubject)!;
    const schema = schemaOf(table);
    const entry = (ownership.tables[tableSubject] ??= { schema, readers: [], writers: [] });
    const used = u.write.length ? u.write : u.read;
    const record: TableUsage = {
      deployable,
      evidence: used.flatMap((f) => f.evidence).slice(0, 8),
      ...(used[0]?.data.orm ? { orm: String(used[0].data.orm) } : {}),
    };
    (u.write.length ? entry.writers : entry.readers).push(record);
    const s = (ownership.schemas[schema] ??= { owners: [], writers: [] });
    if (u.write.length && !s.writers.includes(deployable)) s.writers.push(deployable);
    out.push({
      type: 'orm-usage',
      subject: `${deployable}->${tableSubject}`,
      data: { deployable, table: tableSubject, op: u.write.length ? 'write' : 'read' },
      evidence: record.evidence,
      confidence: Math.max(...used.map((f) => f.confidence)),
      detector: 'ownership',
      relation: {
        type: u.write.length ? 'writes' : 'reads',
        from: deployable,
        to: tableSubject,
        ...(record.orm ? { via: record.orm } : {}),
      },
    });
  }

  for (const m of facts.filter((x) => x.type === 'migrations')) {
    const d = m.data as {
      deployable: string;
      tables?: string[];
      schemas?: string[];
      tool?: string;
    };
    const touched = new Set(d.schemas ?? []);
    for (const name of d.tables ?? []) {
      const t = lookup.get(norm(name));
      if (t) touched.add(schemaOf(t));
    }
    for (const schema of touched) {
      const s = (ownership.schemas[schema] ??= { owners: [], writers: [] });
      if (s.owners.some((o) => o.deployable === d.deployable)) continue;
      s.owners.push({
        deployable: d.deployable,
        evidence: m.evidence,
        ...(d.tool ? { orm: d.tool } : {}),
      });
    }
  }
  for (const [schema, s] of Object.entries(ownership.schemas)) {
    // One owner: it migrates the schema. Several: RNP-002 reports it, nobody gets the edge.
    if (s.owners.length !== 1) continue;
    const owner = s.owners[0]!;
    out.push({
      type: 'migrations',
      subject: `${owner.deployable}->${schema}`,
      data: { deployable: owner.deployable, schema },
      evidence: owner.evidence,
      confidence: 0.9,
      detector: 'ownership',
      relation: { type: 'migrates', from: owner.deployable, to: schema },
    });
  }
  return { ownership, facts: out };
}
