import ts from 'typescript';

/**
 * A static value from the source: literals as they are, objects and arrays of values, and
 * markers for what cannot be known without running the code. Nothing is executed.
 */
export type Value =
  | string
  | number
  | boolean
  | null
  | Value[]
  | { [key: string]: Value }
  | { $ref: string }
  | { $tpl: string }
  | { $call: string; args: Value[] }
  | { $new: string }
  | { $import: string }
  | { $jsx: string }
  | { $fn: true }
  /** `a ?? b`, `a || b`: either side. */
  | { $either: Value[] }
  | { $expr: string };

export interface ImportRef {
  specifier: string;
  line: number;
  names: string[];
  typeOnly: boolean;
  kind: 'import' | 'export' | 'require' | 'dynamic';
}

export interface CallRef {
  /** Normalized callee: `db.select().from` → "db.select.from". */
  callee: string;
  line: number;
  args: Value[];
  new?: boolean;
  /** Callees of the calls this one sits inside, nearest first (for example "prisma.$transaction"). */
  inside: string[];
  /** Name of the enclosing function, method or variable. */
  in?: string;
}

export interface DecoratorRef {
  name: string;
  line: number;
  args: Value[];
  target: string;
  targetKind: 'class' | 'method' | 'property' | 'parameter';
  /** The class the target belongs to. */
  className?: string;
}

export interface JsxRef {
  tag: string;
  line: number;
  attrs: Record<string, Value>;
}

export interface ClassRef {
  name: string;
  line: number;
  extends?: string;
}

/** What detectors need from one source file (cached by content hash). */
export interface FileIndex {
  imports: ImportRef[];
  calls: CallRef[];
  decorators: DecoratorRef[];
  jsx: JsxRef[];
  classes: ClassRef[];
  /** Exported names ("default" for a default export). */
  exports: string[];
  /** Top-level variables initialized by a call or `new`: name → callee. */
  bindings: Record<string, string>;
}

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
export const isCode = (file: string) =>
  CODE_EXTENSIONS.some((e) => file.endsWith(e)) && !file.endsWith('.d.ts');

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(m|c)?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** `a.b().c` → "a.b.c"; `this.repo.find` → "this.repo.find". */
export function calleeName(expr: ts.Expression): string {
  if (ts.isIdentifier(expr) || ts.isPrivateIdentifier(expr)) return expr.text;
  if (expr.kind === ts.SyntaxKind.ThisKeyword) return 'this';
  if (expr.kind === ts.SyntaxKind.SuperKeyword) return 'super';
  if (ts.isPropertyAccessExpression(expr))
    return `${calleeName(expr.expression)}.${expr.name.text}`;
  if (ts.isElementAccessExpression(expr) && ts.isStringLiteralLike(expr.argumentExpression))
    return `${calleeName(expr.expression)}.${expr.argumentExpression.text}`;
  if (ts.isCallExpression(expr)) return calleeName(expr.expression);
  if (ts.isNonNullExpression(expr) || ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr))
    return calleeName(expr.expression);
  if (ts.isAwaitExpression(expr)) return calleeName(expr.expression);
  if (ts.isNewExpression(expr)) return calleeName(expr.expression);
  return '?';
}

function value(node: ts.Expression | undefined, depth = 0): Value {
  if (!node) return null;
  if (depth > 6) return { $expr: 'deep' };
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isTemplateExpression(node))
    return {
      $tpl:
        node.head.text +
        node.templateSpans.map((s) => `\${${s.expression.getText()}}${s.literal.text}`).join(''),
    };
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    return value(node.expression, depth);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((e) => value(e, depth + 1));
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, Value> = {};
    for (const p of node.properties) {
      const key =
        p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name))
          ? p.name.text
          : undefined;
      if (!key) continue;
      if (ts.isPropertyAssignment(p)) out[key] = value(p.initializer, depth + 1);
      else if (ts.isShorthandPropertyAssignment(p)) out[key] = { $ref: key };
      else if (ts.isMethodDeclaration(p)) out[key] = { $fn: true };
    }
    return out;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return { $fn: true };
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node))
    return { $ref: calleeName(node) };
  if (ts.isCallExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const spec = node.arguments[0];
      return { $import: spec && ts.isStringLiteralLike(spec) ? spec.text : '?' };
    }
    return {
      $call: calleeName(node.expression),
      args: node.arguments.map((a) => value(a, depth + 1)),
    };
  }
  if (ts.isNewExpression(node)) return { $new: calleeName(node.expression) };
  if (ts.isJsxElement(node)) return { $jsx: node.openingElement.tagName.getText() };
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
    return { $jsx: node.tagName.getText() };
  if (ts.isAwaitExpression(node)) return value(node.expression, depth);
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  )
    return { $either: [value(node.left, depth + 1), value(node.right, depth + 1)] };
  return { $expr: ts.SyntaxKind[node.kind] ?? 'expression' };
}

const decoratorsOf = (node: ts.Node) =>
  ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];

/** Parses one file (syntax only; no types, no other files) and builds its index. */
export function indexSource(file: string, text: string): FileIndex {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const index: FileIndex = {
    imports: [],
    calls: [],
    decorators: [],
    jsx: [],
    classes: [],
    exports: [],
    bindings: {},
  };

  const nameOf = (n: ts.Node): string | undefined => {
    if (
      (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isClassDeclaration(n)) &&
      n.name
    )
      return n.name.getText(sf);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
    if (ts.isPropertyAssignment(n) && n.name) return n.name.getText(sf);
    return undefined;
  };

  const addDecorators = (
    node: ts.Node,
    target: string,
    kind: DecoratorRef['targetKind'],
    cls?: string,
  ) => {
    for (const d of decoratorsOf(node)) {
      const e = d.expression;
      index.decorators.push({
        name: calleeName(ts.isCallExpression(e) ? e.expression : e),
        line: lineOf(d),
        args: ts.isCallExpression(e) ? e.arguments.map((a) => value(a)) : [],
        target,
        targetKind: kind,
        ...(cls ? { className: cls } : {}),
      });
    }
  };

  const visit = (
    node: ts.Node,
    inside: string[],
    within: string | undefined,
    cls: string | undefined,
  ) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const c = node.importClause;
      const names: string[] = [];
      if (c?.name) names.push(c.name.text);
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings))
        names.push(...c.namedBindings.elements.map((e) => (e.propertyName ?? e.name).text));
      if (c?.namedBindings && ts.isNamespaceImport(c.namedBindings)) names.push('*');
      index.imports.push({
        specifier: node.moduleSpecifier.text,
        line: lineOf(node),
        names,
        typeOnly: Boolean(c?.isTypeOnly),
        kind: 'import',
      });
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier))
        index.imports.push({
          specifier: node.moduleSpecifier.text,
          line: lineOf(node),
          names: [],
          typeOnly: node.isTypeOnly,
          kind: 'export',
        });
      if (node.exportClause && ts.isNamedExports(node.exportClause))
        index.exports.push(...node.exportClause.elements.map((e) => e.name.text));
    } else if (ts.isExportAssignment(node)) {
      index.exports.push('default');
    }

    const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
    const exported = modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (exported && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)))
      index.exports.push(isDefault ? 'default' : (node.name?.text ?? 'default'));
    if (exported && ts.isVariableStatement(node))
      for (const d of node.declarationList.declarations)
        if (ts.isIdentifier(d.name)) index.exports.push(d.name.text);

    if (ts.isClassDeclaration(node) && node.name) {
      const heritage = node.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
      index.classes.push({
        name: node.name.text,
        line: lineOf(node),
        ...(heritage?.types[0] ? { extends: heritage.types[0].expression.getText(sf) } : {}),
      });
      addDecorators(node, node.name.text, 'class');
      cls = node.name.text;
    }
    if ((ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) && node.name)
      addDecorators(
        node,
        node.name.getText(sf),
        ts.isMethodDeclaration(node) ? 'method' : 'property',
        cls,
      );
    if (ts.isParameter(node) && node.name)
      addDecorators(node, node.name.getText(sf), 'parameter', cls);

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isSourceFile(node.parent.parent.parent)
    ) {
      let init: ts.Expression = node.initializer;
      while (ts.isAwaitExpression(init) || ts.isParenthesizedExpression(init))
        init = init.expression;
      if (ts.isCallExpression(init) || ts.isNewExpression(init))
        index.bindings[node.name.text] = calleeName(init.expression);
    }

    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = node.arguments[0];
        if (spec && ts.isStringLiteralLike(spec))
          index.imports.push({
            specifier: spec.text,
            line: lineOf(node),
            names: [],
            typeOnly: false,
            kind: 'dynamic',
          });
      } else {
        const callee = calleeName(node.expression);
        if (callee === 'require' && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))
          index.imports.push({
            specifier: node.arguments[0].text,
            line: lineOf(node),
            names: [],
            typeOnly: false,
            kind: 'require',
          });
        index.calls.push({
          callee,
          line: lineOf(node),
          args: node.arguments.map((a) => value(a)),
          inside: inside.slice(0, 5),
          ...(within ? { in: within } : {}),
        });
        // Arguments run "inside" this call (callbacks of $transaction, route handlers ...).
        ts.forEachChild(node.expression, (c) => visit(c, inside, within, cls));
        for (const a of node.arguments) visit(a, [callee, ...inside], within, cls);
        return;
      }
    }
    if (ts.isNewExpression(node)) {
      index.calls.push({
        callee: calleeName(node.expression),
        line: lineOf(node),
        args: (node.arguments ?? []).map((a) => value(a)),
        new: true,
        inside: inside.slice(0, 5),
        ...(within ? { in: within } : {}),
      });
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs: Record<string, Value> = {};
      for (const a of node.attributes.properties) {
        if (!ts.isJsxAttribute(a)) continue;
        const name = a.name.getText(sf);
        const init = a.initializer;
        attrs[name] = !init
          ? true
          : ts.isStringLiteral(init)
            ? init.text
            : ts.isJsxExpression(init)
              ? value(init.expression)
              : { $jsx: '?' };
      }
      index.jsx.push({ tag: node.tagName.getText(sf), line: lineOf(node), attrs });
    }
    const name = nameOf(node);
    ts.forEachChild(node, (c) => visit(c, inside, name ?? within, cls));
  };
  visit(sf, [], undefined, undefined);
  return index;
}

/** A marker field of a value (`$tpl`, `$call` …), when the value has it. */
const marker = (v: Value | undefined, key: string): unknown =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>)[key] : undefined;

/** A string value, also when it is a template with placeholders ("/orders/${id}"). */
export const text = (v: Value | undefined): string | undefined => {
  if (typeof v === 'string') return v;
  const t = marker(v, '$tpl');
  return typeof t === 'string' ? t : undefined;
};

/** The callee of a call value (`uuid('id').references(…)` → "uuid.references"). */
export const callOf = (v: Value | undefined): string | undefined => {
  const c = marker(v, '$call');
  return typeof c === 'string' ? c : undefined;
};

/** An object value (not a marker). */
export const obj = (v: Value | undefined): Record<string, Value> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).some((k) => k.startsWith('$'))
    ? (v as Record<string, Value>)
    : undefined;

export const ref = (v: Value | undefined): string | undefined =>
  v && typeof v === 'object' && '$ref' in v ? (v as { $ref: string }).$ref : undefined;

/** Every number in a value, depth first ("Number(process.env.PORT ?? 3000)" → [3000]). */
export function numbersIn(v: Value | undefined): number[] {
  if (typeof v === 'number') return [v];
  if (!v || typeof v !== 'object') return [];
  if (Array.isArray(v)) return v.flatMap(numbersIn);
  return Object.values(v).flatMap((x) => numbersIn(x as Value));
}
