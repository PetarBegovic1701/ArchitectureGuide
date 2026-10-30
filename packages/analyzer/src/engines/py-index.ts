/**
 * What the Python detectors need from a module (Implementation.md §19.3), read without
 * running Python: imports, decorators with their arguments, classes with their bases and
 * class-level assignments, calls and environment variable names. Statements are joined over
 * open brackets and backslashes, so a decorator or a call over several lines is one item.
 */

export interface PyImport {
  /** "app.api.orders" for `from app.api import orders`, "httpx" for `import httpx`. */
  module: string;
  /** Imported names (`from m import a, b as c` → ["a", "c"]); empty for `import m`. */
  names: string[];
  /** Local alias of `import m as x`. */
  alias?: string;
  /** Leading dots of a relative import. */
  level: number;
  line: number;
}

export interface PyCall {
  /** Dotted callee: "app.include_router", "FastAPI", "session.add". */
  callee: string;
  /** The argument text, without the outer parentheses. */
  args: string;
  line: number;
}

export interface PyDecorator {
  /** Dotted callee: "router.get", "app.task", "dataclass". */
  callee: string;
  args: string;
  line: number;
  /** The decorated function or class. */
  target: string;
  targetKind: 'function' | 'class';
  /** The class a decorated method belongs to. */
  className?: string;
}

export interface PyClass {
  name: string;
  /** Base class expressions: "Base", "models.Model", "SQLModel", "table=True". */
  bases: string[];
  line: number;
  /** Assignments directly in the class body: `__tablename__ = "orders"`, `id = Column(...)`. */
  fields: { name: string; annotation?: string; value: string; line: number }[];
  /** Nested `class Meta:` assignments (Django). */
  meta: Record<string, string>;
}

export interface PyIndex {
  imports: PyImport[];
  decorators: PyDecorator[];
  classes: PyClass[];
  calls: PyCall[];
  /** Module-level assignments: `app = FastAPI()`, `router = APIRouter(prefix="/x")`. */
  assigns: { name: string; value: string; line: number }[];
  /** String literals, with their line (SQL in strings, URL patterns). */
  strings: { value: string; line: number }[];
  /** Environment variables read: os.environ["X"], os.getenv("X"), os.environ.get("X"). */
  env: { name: string; line: number }[];
}

interface Statement {
  text: string;
  line: number;
  indent: number;
}

/** Splits source into logical statements: comments and docstrings out, brackets joined. */
function statements(source: string): { list: Statement[]; strings: PyIndex['strings'] } {
  const list: Statement[] = [];
  const strings: PyIndex['strings'] = [];
  let buf = '';
  let depth = 0;
  let start = 0;
  let indent = 0;
  let line = 1;
  let i = 0;
  const flush = () => {
    const text = buf.trim();
    if (text) list.push({ text, line: start, indent });
    buf = '';
  };
  let atLineStart = true;
  while (i < source.length) {
    const c = source[i]!;
    if (atLineStart && depth === 0 && !buf.trim()) {
      let j = i;
      let n = 0;
      while (source[j] === ' ' || source[j] === '\t') {
        n += source[j] === '\t' ? 4 : 1;
        j++;
      }
      indent = n;
      start = line;
      atLineStart = false;
    }
    if (c === '#') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '"' || c === "'") {
      // Prefixes (f, r, b, rb …) are already in the buffer; read the string.
      const triple = source.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      const from = line;
      let j = i + quote.length;
      let value = '';
      while (j < source.length && !source.startsWith(quote, j)) {
        if (source[j] === '\\') {
          value += source[j + 1] ?? '';
          j += 2;
          continue;
        }
        if (source[j] === '\n') {
          line++;
          if (!triple) break;
        }
        value += source[j++];
      }
      i = j + quote.length;
      strings.push({ value, line: from });
      // Docstrings and other bare strings are not statements.
      buf += JSON.stringify(value);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    if (c === '\\' && source[i + 1] === '\n') {
      i += 2;
      line++;
      buf += ' ';
      continue;
    }
    if (c === '\n') {
      line++;
      if (depth === 0) {
        flush();
        atLineStart = true;
      } else buf += ' ';
      i++;
      continue;
    }
    if (c === ';' && depth === 0) {
      flush();
      start = line;
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return { list, strings };
}

/** Text between the parenthesis at `open` and its match. */
export function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // Strings are JSON-encoded by `statements`, so a closing quote is an unescaped one.
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

/** The first string literal of an argument text: `"/orders", tags=["x"]` → "/orders". */
export function firstString(args: string): string | undefined {
  const m = /^\s*(?:[A-Za-z_]\w*\s*=\s*)?("(?:[^"\\]|\\.)*")/.exec(args);
  return m ? (JSON.parse(m[1]!) as string) : undefined;
}

/** A keyword argument's string value: `prefix="/orders"` → "/orders". */
export function kwString(args: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(args);
  return m ? (JSON.parse(m[1]!) as string) : undefined;
}

/** Every string literal in an argument text. */
export function stringsIn(args: string): string[] {
  return [...args.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]!}"`) as string);
}

const ENV = [
  /os\.environ\s*\[\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\]/g,
  /os\.(?:environ\.get|getenv)\s*\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /\benv(?:\.str|\.int|\.bool|\.url)?\s*\(\s*"([A-Z][A-Z0-9_]*)"/g,
  /\bconfig\s*\(\s*"([A-Z][A-Z0-9_]*)"/g,
];

const CALL = /([A-Za-z_][\w.]*)\s*\(/g;

/** Indexes one Python module. */
export function indexPython(source: string): PyIndex {
  const { list, strings } = statements(source);
  const index: PyIndex = {
    imports: [],
    decorators: [],
    classes: [],
    calls: [],
    assigns: [],
    strings,
    env: [],
  };
  const pending: { callee: string; args: string; line: number }[] = [];
  /** Open blocks, innermost last: a class body, its `class Meta:`, or a function body. */
  const scopes: { kind: 'class' | 'meta' | 'def'; cls?: PyClass; indent: number }[] = [];
  for (const st of list) {
    while (scopes.length && st.indent <= scopes[scopes.length - 1]!.indent) scopes.pop();
    const scope = scopes[scopes.length - 1];
    const t = st.text;

    for (const re of ENV)
      for (const m of t.matchAll(re)) index.env.push({ name: m[1]!, line: st.line });

    let m: RegExpExecArray | null;
    if ((m = /^import\s+(.+)$/.exec(t))) {
      for (const part of m[1]!.split(',')) {
        const [mod, alias] = part.trim().split(/\s+as\s+/);
        if (mod)
          index.imports.push({
            module: mod,
            names: [],
            ...(alias ? { alias } : {}),
            level: 0,
            line: st.line,
          });
      }
      continue;
    }
    if ((m = /^from\s+(\.*)([\w.]*)\s+import\s+(.+)$/.exec(t))) {
      const names = m[3]!
        .replace(/[()]/g, '')
        .split(',')
        .map((x) =>
          x
            .trim()
            .split(/\s+as\s+/)
            .pop()!,
        )
        .filter(Boolean);
      index.imports.push({ module: m[2]!, names, level: m[1]!.length, line: st.line });
      continue;
    }
    if ((m = /^@([A-Za-z_][\w.]*)\s*(\()?/.exec(t))) {
      pending.push({
        callee: m[1]!,
        args: m[2] ? balanced(t, t.indexOf('(')) : '',
        line: st.line,
      });
      continue;
    }
    if ((m = /^class\s+([A-Za-z_]\w*)\s*(\()?/.exec(t))) {
      if (scope?.kind === 'class' && m[1] === 'Meta') {
        scopes.push({ kind: 'meta', cls: scope.cls!, indent: st.indent });
        continue;
      }
      const bases = m[2]
        ? balanced(t, t.indexOf('('))
            .split(',')
            .map((b) => b.trim())
            .filter(Boolean)
        : [];
      const cls: PyClass = { name: m[1]!, bases, line: st.line, fields: [], meta: {} };
      index.classes.push(cls);
      scopes.push({ kind: 'class', cls, indent: st.indent });
      for (const d of pending.splice(0))
        index.decorators.push({ ...d, target: cls.name, targetKind: 'class' });
      continue;
    }
    if ((m = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(t))) {
      for (const d of pending.splice(0))
        index.decorators.push({
          ...d,
          target: m[1]!,
          targetKind: 'function',
          ...(scope?.kind === 'class' ? { className: scope.cls!.name } : {}),
        });
      scopes.push({ kind: 'def', indent: st.indent });
      collectCalls(t, st.line, index);
      continue;
    }
    pending.length = 0;
    const assign = /^([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*=\s*(?!=)(.+)$/.exec(t);
    if (assign) {
      const name = assign[1]!;
      const annotation = assign[2];
      const value = assign[3]!;
      if (!scope) index.assigns.push({ name, value, line: st.line });
      else if (scope.kind === 'meta') scope.cls!.meta[name] = value;
      else if (scope.kind === 'class')
        scope.cls!.fields.push({
          name,
          ...(annotation ? { annotation: annotation.trim() } : {}),
          value,
          line: st.line,
        });
    } else if (scope?.kind === 'class') {
      // An annotated field without a value: `name: Mapped[str]`.
      const field = /^([A-Za-z_]\w*)\s*:\s*(.+)$/.exec(t);
      if (field)
        scope.cls!.fields.push({
          name: field[1]!,
          annotation: field[2]!.trim(),
          value: '',
          line: st.line,
        });
    }
    collectCalls(t, st.line, index);
  }
  return index;
}

function collectCalls(text: string, line: number, index: PyIndex): void {
  for (const m of text.matchAll(CALL)) {
    const callee = m[1]!;
    if (/^(if|for|while|return|and|or|not|in|def|class|print|elif|with|lambda)$/.test(callee))
      continue;
    const open = m.index + m[0].length - 1;
    index.calls.push({ callee, args: balanced(text, open), line });
  }
}
