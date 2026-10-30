/**
 * What the .NET detectors need from a C# file (Implementation.md §19.3), read without
 * compiling: usings, classes with their attributes and base types, attributed methods,
 * calls with their first string argument, `DbSet<T>` properties, configuration keys and
 * string literals. Comments are removed first; line numbers stay those of the source.
 */

export interface CsAttribute {
  /** "HttpGet", "Route", "Table" (without the "Attribute" suffix). */
  name: string;
  /** Text between the parentheses, "" when there are none. */
  args: string;
  line: number;
}

export interface CsMethod {
  name: string;
  attributes: CsAttribute[];
  line: number;
}

export interface CsClass {
  name: string;
  /** Base class and interfaces: "ControllerBase", "DbContext", "IConsumer<OrderPlaced>". */
  bases: string[];
  attributes: CsAttribute[];
  methods: CsMethod[];
  /** `DbSet<Order> Orders`: entity type and property name. */
  dbSets: { entity: string; name: string; line: number }[];
  line: number;
  /** Offsets of the body, for calls inside the class. */
  start: number;
  end: number;
}

export interface CsCall {
  /** The receiver and method: "app.MapGet", "builder.Services.AddDbContext". */
  callee: string;
  /** Generic arguments: `AddDbContext<OrdersDb>` → "OrdersDb". */
  generic?: string;
  /** First string literal argument, when the first argument is one. */
  first?: string;
  /** The argument text (up to 400 characters). */
  args: string;
  line: number;
  offset: number;
}

export interface CsIndex {
  usings: string[];
  namespace?: string;
  classes: CsClass[];
  calls: CsCall[];
  /** Configuration and environment keys read: Configuration["X"], GetConnectionString("X") … */
  config: { key: string; line: number; kind: 'config' | 'connection-string' | 'env' }[];
  strings: { value: string; line: number }[];
}

/** Removes comments and keeps strings (regular, verbatim, interpolated, raw) intact. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      // Keep the line breaks so line numbers stay right.
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === '"') {
      const raw = src.startsWith('"""', i);
      const verbatim = src[i - 1] === '@' || src[i - 2] === '@';
      let j = i + (raw ? 3 : 1);
      while (j < src.length) {
        if (raw && src.startsWith('"""', j)) {
          j += 3;
          break;
        }
        if (!raw && src[j] === '"') {
          if (verbatim && src[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        if (!raw && !verbatim && src[j] === '\\') j++;
        if (!raw && !verbatim && src[j] === '\n') break;
        j++;
      }
      out += src.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Text between the bracket at `open` and its match (strings skipped). */
export function csBalanced(text: string, open: number): { inner: string; end: number } {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']', '<': '>' };
  const close = pairs[text[open]!]!;
  const opener = text[open]!;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      continue;
    }
    if (c === opener) depth++;
    if (c === close) {
      depth--;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i };
    }
  }
  return { inner: text.slice(open + 1), end: text.length };
}

/** The value of the first string literal in an argument text: `"/orders", x` → "/orders". */
export function csFirstString(args: string): string | undefined {
  const m = /^\s*(?:\w+\s*:\s*)?[@$]{0,2}"((?:[^"\\]|\\.|"")*)"/.exec(args);
  return m ? m[1]!.replace(/""/g, '"').replace(/\\(.)/g, '$1') : undefined;
}

/** A named argument's string value: `Schema = "orders"` or `schema: "orders"`. */
export function csNamedString(args: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*[:=]\\s*@?"([^"]*)"`, 'i').exec(args);
  return m?.[1];
}

const KEYWORDS = new Set([
  'if',
  'for',
  'foreach',
  'while',
  'switch',
  'catch',
  'using',
  'return',
  'new',
  'typeof',
  'nameof',
  'sizeof',
  'lock',
  'when',
  'default',
]);

/** Indexes one C# file. */
export function indexCSharp(source: string): CsIndex {
  const text = stripComments(source);
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const index: CsIndex = { usings: [], classes: [], calls: [], config: [], strings: [] };

  for (const m of text.matchAll(/^\s*(?:global\s+)?using\s+(?:static\s+)?([\w.]+)\s*;/gm))
    index.usings.push(m[1]!);
  const ns = /\bnamespace\s+([\w.]+)/.exec(text);
  if (ns) index.namespace = ns[1]!;

  for (const m of text.matchAll(/[@$]{0,2}"((?:[^"\\\n]|\\.|"")*)"/g))
    index.strings.push({ value: m[1]!, line: lineAt(m.index) });

  /** Attributes right before `offset`: `[A] [B(x)]` blocks separated by white space. */
  const attributesBefore = (offset: number): CsAttribute[] => {
    const out: CsAttribute[] = [];
    let i = offset - 1;
    for (;;) {
      while (i >= 0 && /\s/.test(text[i]!)) i--;
      if (text[i] !== ']') break;
      // Find the matching "[".
      let depth = 0;
      let j = i;
      for (; j >= 0; j--) {
        if (text[j] === ']') depth++;
        if (text[j] === '[') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j < 0) break;
      const block = text.slice(j + 1, i);
      const parsed = splitTop(block).flatMap((part) => {
        const a = /^\s*(?:\w+\s*:\s*)?([\w.]+)\s*(\()?/.exec(part);
        if (!a) return [];
        const name = a[1]!
          .split('.')
          .pop()!
          .replace(/Attribute$/, '');
        const args = a[2] ? csBalanced(part, part.indexOf('(')).inner : '';
        return [{ name, args, line: lineAt(j) }];
      });
      // Blocks are read backwards; the attributes of one block keep their order.
      out.unshift(...parsed);
      i = j - 1;
    }
    return out;
  };

  const classRe =
    /\b(?:(?:public|internal|private|protected|static|sealed|abstract|partial|file|readonly)\s+)*(class|record|struct|interface)\s+([A-Za-z_]\w*)\s*(<[^>{(]*>)?\s*(\([^)]*\))?\s*(?::\s*([^{;]+?))?\s*(?:where\s+[^{]+)?\{/g;
  for (const m of text.matchAll(classRe)) {
    const declStart = m.index;
    // Modifiers are part of the match; attributes come before them.
    const open = m.index + m[0].length - 1;
    const { end } = csBalanced(text, open);
    const bases = (m[5] ?? '')
      .split(/,(?![^<]*>)/)
      .map((b) => b.trim())
      .filter(Boolean);
    index.classes.push({
      name: m[2]!,
      bases,
      attributes: attributesBefore(declStart),
      methods: [],
      dbSets: [],
      line: lineAt(declStart + m[0].search(/\b(class|record|struct|interface)\b/)),
      start: open,
      end,
    });
  }
  const innermost = (offset: number) =>
    index.classes
      .filter((c) => c.start < offset && offset < c.end)
      .sort((a, b) => b.start - a.start)[0];

  const methodRe =
    /\b(?:(?:public|internal|private|protected|static|virtual|override|async|sealed|new|abstract|partial)\s+)+[\w<>,.?[\]\s]+?\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/g;
  for (const m of text.matchAll(methodRe)) {
    const cls = innermost(m.index);
    if (!cls || KEYWORDS.has(m[1]!) || m[1] === cls.name) continue;
    cls.methods.push({
      name: m[1]!,
      attributes: attributesBefore(m.index),
      line: lineAt(m.index),
    });
  }
  for (const m of text.matchAll(/\bDbSet\s*<\s*([\w.]+)\s*>\s+([A-Za-z_]\w*)/g)) {
    const cls = innermost(m.index);
    cls?.dbSets.push({ entity: m[1]!.split('.').pop()!, name: m[2]!, line: lineAt(m.index) });
  }

  const callRe = /([A-Za-z_][\w.]*?)\s*(?:<([\w.,\s<>]+)>)?\s*\(/g;
  for (const m of text.matchAll(callRe)) {
    const callee = m[1]!;
    const last = callee.split('.').pop()!;
    if (KEYWORDS.has(last) || KEYWORDS.has(callee)) continue;
    // A declaration ("void Foo(") is not a call.
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    if (
      /\b(class|record|struct|interface|void|Task|public|private|protected|internal)\s+$/.test(
        before,
      )
    )
      continue;
    const open = m.index + m[0].length - 1;
    const inner = csBalanced(text, open).inner;
    const first = csFirstString(inner);
    index.calls.push({
      callee,
      ...(m[2] ? { generic: m[2].trim() } : {}),
      ...(first !== undefined ? { first } : {}),
      args: inner.slice(0, 400),
      line: lineAt(m.index),
      offset: m.index,
    });
  }

  const config: [RegExp, CsIndex['config'][number]['kind']][] = [
    [/Configuration\s*\[\s*"([^"]+)"\s*\]/g, 'config'],
    [/GetConnectionString\s*\(\s*"([^"]+)"/g, 'connection-string'],
    [/Environment\.GetEnvironmentVariable\s*\(\s*"([^"]+)"/g, 'env'],
    [/GetValue\s*<[^>]+>\s*\(\s*"([^"]+)"/g, 'config'],
    [/GetSection\s*\(\s*"([^"]+)"/g, 'config'],
  ];
  for (const [re, kind] of config)
    for (const m of text.matchAll(re))
      index.config.push({ key: m[1]!, line: lineAt(m.index), kind });
  return index;
}

/** Splits on top-level commas: `A, B(x, y)` → ["A", "B(x, y)"]. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' && text[i - 1] !== '\\') inString = !inString;
    if (!inString) {
      if (c === '(' || c === '<' || c === '[') depth++;
      if (c === ')' || c === '>' || c === ']') depth--;
      if (c === ',' && depth === 0) {
        parts.push(cur);
        cur = '';
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}
