/** The parts of a `schema.prisma` file the analyzer needs (Implementation.md §19.4). */
export interface PrismaField {
  name: string;
  type: string;
  line: number;
  list: boolean;
  optional: boolean;
  id: boolean;
  unique: boolean;
  /** Column name (`@map`). */
  column?: string;
  /** `@relation(fields: [...], references: [...])`: this side holds the foreign key. */
  relation?: { fields: string[]; references: string[] };
}

export interface PrismaModel {
  name: string;
  line: number;
  /** Table name (`@@map`), else the model name. */
  table: string;
  /** `@@schema`, else "public". */
  schema: string;
  fields: PrismaField[];
  /** Field lists of `@@index`, `@@unique` and `@@id`. */
  indexes: string[][];
  view: boolean;
}

export interface PrismaSchema {
  provider?: string;
  schemas: string[];
  models: PrismaModel[];
  enums: string[];
}

const list = (s: string | undefined) =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);

/** Arguments of `@@index([a, b], name: "x")` or `@relation(fields: [a], references: [b])`. */
function bracketArg(attr: string, key?: string): string[] {
  const m = key
    ? new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(attr)
    : /\(\s*(?:fields\s*:\s*)?\[([^\]]*)\]/.exec(attr);
  return list(m?.[1]).map((x) => x.replace(/\(.*\)$/, ''));
}

/** A small, tolerant parser: blocks, fields and attributes; comments ignored. */
export function parsePrisma(text: string): PrismaSchema {
  const out: PrismaSchema = { schemas: [], models: [], enums: [] };
  const lines = text.split(/\r?\n/);
  let block: { type: string; name: string; line: number } | null = null;
  let model: PrismaModel | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const open = /^(model|view|enum|datasource|generator|type)\s+(\w+)\s*\{/.exec(line);
    if (open) {
      block = { type: open[1]!, name: open[2]!, line: i + 1 };
      if (block.type === 'model' || block.type === 'view') {
        model = {
          name: block.name,
          line: i + 1,
          table: block.name,
          schema: 'public',
          fields: [],
          indexes: [],
          view: block.type === 'view',
        };
        out.models.push(model);
      }
      if (block.type === 'enum') out.enums.push(block.name);
      continue;
    }
    if (line.startsWith('}')) {
      block = null;
      model = null;
      continue;
    }
    if (!block) continue;
    if (block.type === 'datasource') {
      const provider = /^provider\s*=\s*"([^"]+)"/.exec(line);
      if (provider) out.provider = provider[1];
      const schemas = /^schemas\s*=\s*\[([^\]]*)\]/.exec(line);
      if (schemas) out.schemas = list(schemas[1]);
      continue;
    }
    if (!model) continue;
    if (line.startsWith('@@')) {
      const map = /^@@map\(\s*"([^"]+)"/.exec(line);
      if (map) model.table = map[1]!;
      const schema = /^@@schema\(\s*"([^"]+)"/.exec(line);
      if (schema) model.schema = schema[1]!;
      if (/^@@(index|unique|id)\(/.test(line)) model.indexes.push(bracketArg(line));
      continue;
    }
    const field = /^(\w+)\s+([\w.]+)(\[\])?(\?)?\s*(.*)$/.exec(line);
    if (!field) continue;
    const attrs = field[5] ?? '';
    const relation = /@relation\(([^)]*\))?[^)]*\)/.exec(attrs)?.[0];
    const column = /@map\(\s*"([^"]+)"/.exec(attrs)?.[1];
    const fk = relation ? bracketArg(relation, 'fields') : [];
    model.fields.push({
      name: field[1]!,
      type: field[2]!,
      line: i + 1,
      list: Boolean(field[3]),
      optional: Boolean(field[4]),
      id: /@id\b/.test(attrs),
      unique: /@unique\b/.test(attrs),
      ...(column ? { column } : {}),
      ...(fk.length
        ? { relation: { fields: fk, references: bracketArg(relation!, 'references') } }
        : {}),
    });
  }
  // Without `@@schema`, models live in the first listed schema or "public".
  if (out.schemas.length === 0) out.schemas = ['public'];
  return out;
}
