import type { OpError } from '../ops';
import type { Element, ElementDocs, Id, Lang, ModelOp, Project, ProjectDocs } from '../schema';

/**
 * Documentation of the analyzed repository (§7.2): what an AI agent read in the repository's
 * docs or deduced from its code, per element and for the project, in the language the agent
 * wrote it in. The canvas, the inspector and the exports show it as written.
 */

/** Languages written right to left, by primary subtag. */
const RTL_LANGUAGES: ReadonlySet<string> = new Set([
  'ar',
  'arc',
  'ckb',
  'dv',
  'fa',
  'he',
  'iw',
  'ks',
  'nqo',
  'ps',
  'sd',
  'syr',
  'ug',
  'ur',
  'yi',
]);

/** Scripts written right to left; a script subtag ("az-Arab", "ar-Latn") wins over the language. */
const RTL_SCRIPTS: ReadonlySet<string> = new Set([
  'adlm',
  'arab',
  'hebr',
  'mand',
  'nkoo',
  'rohg',
  'samr',
  'syrc',
  'thaa',
]);

/** Writing direction of a language tag; undefined when there is no tag (let the text decide). */
export function textDirection(lang: string | undefined): 'ltr' | 'rtl' | undefined {
  if (!lang) return undefined;
  const [primary = '', ...rest] = lang.toLowerCase().split('-');
  const script = rest.find((s) => s.length === 4);
  if (script) return RTL_SCRIPTS.has(script) ? 'rtl' : 'ltr';
  return RTL_LANGUAGES.has(primary) ? 'rtl' : 'ltr';
}

/** Language of an element's documentation: its own, else the project's. */
export function docsLang(p: Pick<Project, 'docs'>, e: Pick<Element, 'docs'>): Lang | undefined {
  return e.docs?.lang ?? p.docs?.lang;
}

/** The name to show: the documentation's name when there is one. */
export function displayName(e: Pick<Element, 'name' | 'docs'>): string {
  return e.docs?.name ?? e.name;
}

/** True when the element has documentation text to show. */
export function hasDocs(e: Pick<Element, 'docs'>): boolean {
  return Boolean(e.docs?.name || e.docs?.description || e.docs?.function);
}

/** Documentation of one element. A field left out stays as it is; null or "" removes it. */
export interface ElementDocsInput {
  id: Id;
  lang?: string | null;
  name?: string | null;
  description?: string | null;
  function?: string | null;
  basis?: 'read' | 'deduced' | null;
  sources?: string[] | null;
}

/** Documentation of the project. `lang` is required the first time. */
export interface ProjectDocsInput {
  lang?: string;
  summary?: string | null;
  author?: string | null;
  sources?: string[] | null;
}

export interface DocumentationResult {
  ops: ModelOp[];
  /** Documented element IDs, in input order. */
  ids: Id[];
  errors: OpError[];
}

/** Merges a patch into a record: undefined keeps, null and empty values remove, strings are trimmed. */
function merge<T extends object>(current: T | undefined, patch: Record<string, unknown>): T {
  const next: Record<string, unknown> = { ...current };
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === undefined) continue;
    const value = typeof raw === 'string' ? raw.trim() : raw;
    const list = Array.isArray(value)
      ? [...new Set(value.map((x) => String(x).trim()).filter(Boolean))]
      : undefined;
    if (value === null || value === '' || (list && list.length === 0)) delete next[key];
    else next[key] = list ?? value;
  }
  return next as T;
}

/**
 * Turns documentation written by an agent (MCP `write_documentation`) into ops: an
 * `updateProject` for the project's documentation and one `updateElement` per element. The
 * texts are kept as written; `applyOps` validates them.
 */
export function documentationOps(
  project: Project,
  input: { project?: ProjectDocsInput; elements?: readonly ElementDocsInput[] },
  now: string = new Date().toISOString(),
): DocumentationResult {
  const ops: ModelOp[] = [];
  const ids: Id[] = [];
  const errors: OpError[] = [];
  if (input.project) {
    const docs = merge<ProjectDocs>(project.docs, { ...input.project, updatedAt: now });
    if (!docs.lang)
      errors.push({
        index: 0,
        code: 'SCHEMA_INVALID',
        message: 'The project documentation needs its language.',
        hint: 'Set project.lang to the BCP 47 tag of the language you write in, like "en" or "de".',
      });
    else ops.push({ op: 'updateProject', patch: { docs } });
  }
  const elements = new Map(project.model.elements.map((e) => [e.id, e]));
  (input.elements ?? []).forEach(({ id, ...fields }, index) => {
    const current = elements.get(id);
    if (!current) {
      errors.push({
        index,
        code: 'ID_NOT_FOUND',
        itemId: id,
        message: `Unknown element "${id}".`,
        hint: 'get_architecture lists the element IDs; add missing elements with upsert_elements.',
      });
      return;
    }
    const docs = merge<ElementDocs>(current.docs, fields);
    ops.push({
      op: 'updateElement',
      id,
      patch: { docs: Object.keys(docs).length ? docs : null },
    });
    ids.push(id);
  });
  return { ops, ids, errors };
}
