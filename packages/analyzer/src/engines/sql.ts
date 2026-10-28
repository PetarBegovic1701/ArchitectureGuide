import { parse } from 'libpg-query';

export interface SqlTable {
  schema: string;
  name: string;
  line: number;
  columns: string[];
  /** Column → type name ("uuid", "text", "int4"). */
  types: Record<string, string>;
  primaryKey: string[];
}

export interface SqlForeignKey {
  schema: string;
  table: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  line: number;
}

export interface SqlIndex {
  schema: string;
  table: string;
  columns: string[];
  unique: boolean;
  line: number;
}

/** What a migration file creates or touches (Implementation.md §19.4 `pg.sql`). */
export interface SqlFile {
  schemas: { name: string; line: number }[];
  tables: SqlTable[];
  foreignKeys: SqlForeignKey[];
  indexes: SqlIndex[];
  /** Every table the file creates, alters or drops ("schema.table"). */
  touched: string[];
  functions: { schema: string; name: string; line: number }[];
  listens: { channel: string; line: number }[];
  notifies: { channel: string; line: number }[];
  error?: string;
}

type Node = Record<string, unknown>;
const str = (n: unknown): string | undefined => (n as { String?: { sval?: string } })?.String?.sval;

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Parses a migration with the PostgreSQL parser (libpg-query); tolerant of unknown statements. */
export async function parseSql(text: string, defaultSchema = 'public'): Promise<SqlFile> {
  const out: SqlFile = {
    schemas: [],
    tables: [],
    foreignKeys: [],
    indexes: [],
    touched: [],
    functions: [],
    listens: [],
    notifies: [],
  };
  let ast: { stmts?: { stmt: Node; stmt_location?: number }[] };
  try {
    ast = (await parse(text)) as typeof ast;
  } catch (error) {
    out.error = (error as Error).message;
    return out;
  }
  const touch = (schema: string, table: string) => {
    const key = `${schema}.${table}`;
    if (!out.touched.includes(key)) out.touched.push(key);
  };
  for (const { stmt, stmt_location } of ast.stmts ?? []) {
    // stmt_location points at the end of the previous statement; skip to the first word.
    let at = stmt_location ?? 0;
    while (at < text.length && /[\s;]/.test(text[at]!)) at++;
    const line = lineAt(text, at);
    const [kind, body] = Object.entries(stmt)[0] as [string, Node];
    const rel = (r: unknown) => {
      const x = r as { schemaname?: string; relname?: string } | undefined;
      return { schema: x?.schemaname ?? defaultSchema, name: x?.relname ?? '?' };
    };
    if (kind === 'CreateSchemaStmt') out.schemas.push({ name: String(body.schemaname), line });
    else if (kind === 'CreateStmt') {
      const t = rel(body.relation);
      touch(t.schema, t.name);
      const table: SqlTable = {
        schema: t.schema,
        name: t.name,
        line,
        columns: [],
        types: {},
        primaryKey: [],
      };
      for (const el of (body.tableElts as Node[]) ?? []) {
        const col = el.ColumnDef as Node | undefined;
        if (col) {
          const name = String(col.colname);
          table.columns.push(name);
          const names = (((col.typeName as Node)?.names as unknown[]) ?? [])
            .map(str)
            .filter(Boolean);
          table.types[name] = names[names.length - 1] ?? 'unknown';
          for (const c of (col.constraints as Node[]) ?? []) {
            const con = c.Constraint as Node;
            if (con.contype === 'CONSTR_PRIMARY') table.primaryKey.push(name);
            if (con.contype === 'CONSTR_FOREIGN') {
              const ref = rel(con.pktable);
              out.foreignKeys.push({
                schema: t.schema,
                table: t.name,
                columns: [name],
                refSchema: ref.schema,
                refTable: ref.name,
                refColumns: ((con.pk_attrs as unknown[]) ?? []).map((a) => str(a) ?? '?'),
                line,
              });
            }
            if (con.contype === 'CONSTR_UNIQUE')
              out.indexes.push({
                schema: t.schema,
                table: t.name,
                columns: [name],
                unique: true,
                line,
              });
          }
        }
        const con = el.Constraint as Node | undefined;
        if (con) addConstraint(con, t, line);
      }
      if (table.primaryKey.length)
        out.indexes.push({
          schema: t.schema,
          table: t.name,
          columns: table.primaryKey,
          unique: true,
          line,
        });
      out.tables.push(table);
    } else if (kind === 'AlterTableStmt') {
      const t = rel(body.relation);
      touch(t.schema, t.name);
      for (const c of (body.cmds as Node[]) ?? []) {
        const cmd = c.AlterTableCmd as Node;
        const def = cmd?.def as Node | undefined;
        if (def?.Constraint) addConstraint(def.Constraint as Node, t, line);
      }
    } else if (kind === 'IndexStmt') {
      const t = rel(body.relation);
      out.indexes.push({
        schema: t.schema,
        table: t.name,
        columns: ((body.indexParams as Node[]) ?? []).map((p) =>
          String((p.IndexElem as Node)?.name ?? '?'),
        ),
        unique: Boolean(body.unique),
        line,
      });
    } else if (kind === 'DropStmt') {
      for (const o of (body.objects as Node[]) ?? []) {
        const names = ((o.List as Node)?.items as unknown[])?.map(str) ?? [];
        if (body.removeType === 'OBJECT_TABLE' && names.length)
          touch(names.length > 1 ? names[0]! : defaultSchema, names[names.length - 1]!);
      }
    } else if (kind === 'CreateFunctionStmt') {
      const names = ((body.funcname as unknown[]) ?? []).map(str);
      out.functions.push({
        schema: names.length > 1 ? names[0]! : defaultSchema,
        name: names[names.length - 1] ?? '?',
        line,
      });
    } else if (kind === 'ListenStmt')
      out.listens.push({ channel: String(body.conditionname), line });
    else if (kind === 'NotifyStmt')
      out.notifies.push({ channel: String(body.conditionname), line });
  }
  return out;

  function addConstraint(con: Node, t: { schema: string; name: string }, line: number) {
    const keys = ((con.keys as unknown[]) ?? []).map((k) => str(k) ?? '?');
    if (con.contype === 'CONSTR_FOREIGN') {
      const ref = (con.pktable as { schemaname?: string; relname?: string }) ?? {};
      out.foreignKeys.push({
        schema: t.schema,
        table: t.name,
        columns: ((con.fk_attrs as unknown[]) ?? []).map((k) => str(k) ?? '?'),
        refSchema: ref.schemaname ?? defaultSchema,
        refTable: ref.relname ?? '?',
        refColumns: ((con.pk_attrs as unknown[]) ?? []).map((k) => str(k) ?? '?'),
        line,
      });
    } else if (con.contype === 'CONSTR_PRIMARY' || con.contype === 'CONSTR_UNIQUE') {
      out.indexes.push({ schema: t.schema, table: t.name, columns: keys, unique: true, line });
    }
  }
}
