import { Document } from 'yaml';
import type { Element, Id, Project, View } from '../schema';
import type { Facts } from './facts';

// --- API view: endpoints ---------------------------------------------------------------

/** One row of the API view (Implementation.md §17.7). */
export interface EndpointRow {
  id: Id;
  /** The route handler or contract that holds it. */
  parentId?: Id;
  name: string;
  method: string;
  path: string;
  request?: Id;
  response?: Id;
  statusCodes: number[];
  auth: string;
  roles: string[];
  pagination: string;
  idempotent: boolean;
  returnsList: boolean;
  version?: string;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** Elements that describe one API operation: they have a `method` and a `path`. */
export function isEndpoint(e: Element): boolean {
  return Boolean(str(e.properties?.method) && str(e.properties?.path));
}

const defaultStatus = (method: string) =>
  method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;

/** The endpoints inside `scopeId` (or all of them), sorted by path and method. */
export function endpointsOf(project: Project, scopeId?: Id): EndpointRow[] {
  const byId = new Map(project.model.elements.map((e) => [e.id, e]));
  const inside = (e: Element) => {
    if (!scopeId) return true;
    for (
      let cur: Element | undefined = e;
      cur;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    )
      if (cur.id === scopeId) return true;
    return false;
  };
  const order = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  return project.model.elements
    .filter((e) => isEndpoint(e) && inside(e))
    .map((e): EndpointRow => {
      const p = e.properties ?? {};
      const method = String(p.method);
      const codes = Array.isArray(p.statusCodes) ? (p.statusCodes as number[]) : [];
      return {
        id: e.id,
        ...(e.parentId ? { parentId: e.parentId } : {}),
        name: e.name,
        method,
        path: String(p.path),
        ...(str(p.request) ? { request: str(p.request)! } : {}),
        ...(str(p.response) ? { response: str(p.response)! } : {}),
        statusCodes: codes.length ? [...codes].sort() : [defaultStatus(method)],
        auth: str(p.auth) ?? 'none',
        roles: Array.isArray(p.roles) ? (p.roles as string[]) : [],
        pagination: str(p.pagination) ?? 'none',
        idempotent: p.idempotent === true || ['GET', 'PUT', 'DELETE'].includes(method),
        returnsList: p.returnsList === true,
        ...(str(p.version) ? { version: str(p.version)! } : {}),
      };
    })
    .sort(
      (a, b) =>
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
        order.indexOf(a.method) - order.indexOf(b.method),
    );
}

// --- OpenAPI skeleton ----------------------------------------------------------------

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No content',
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  422: 'Unprocessable entity',
  429: 'Too many requests',
  500: 'Server error',
};

const pascal = (name: string) =>
  name
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Schema';

interface Field {
  name: string;
  type: string;
  required?: boolean;
}

function fieldSchema(type: string, refs: Map<string, string>): Record<string, unknown> {
  const t = type.trim();
  if (t.endsWith('[]')) return { type: 'array', items: fieldSchema(t.slice(0, -2), refs) };
  const lower = t.toLowerCase();
  if (['string', 'text'].includes(lower)) return { type: 'string' };
  if (['uuid'].includes(lower)) return { type: 'string', format: 'uuid' };
  if (['date', 'datetime', 'timestamp', 'timestamptz', 'date-time'].includes(lower))
    return { type: 'string', format: lower === 'date' ? 'date' : 'date-time' };
  if (['int', 'integer', 'bigint', 'int4', 'int8'].includes(lower)) return { type: 'integer' };
  if (['number', 'float', 'decimal', 'numeric', 'money'].includes(lower)) return { type: 'number' };
  if (['bool', 'boolean'].includes(lower)) return { type: 'boolean' };
  const ref = refs.get(lower);
  if (ref) return { $ref: `#/components/schemas/${ref}` };
  return { type: 'string', description: t };
}

/**
 * An OpenAPI 3.1 skeleton for the endpoints in the export (a route handler's or contract's,
 * with it as the focus): paths, operations, request and response schemas from the linked
 * data shapes, status codes, auth and pagination parameters.
 */
export function openapi(f: Facts, scopeId?: Id): string {
  const project = f.project;
  const rows = endpointsOf(project, scopeId).filter((r) => f.included.has(r.id));
  const byId = new Map(project.model.elements.map((e) => [e.id, e]));
  const scope = scopeId ? byId.get(scopeId) : undefined;
  // Data shapes: by ID for request/response links, by name for field types.
  const dtoIds = new Set(
    rows.flatMap((r) => [r.request, r.response].filter((x): x is Id => Boolean(x))),
  );
  const schemaName = new Map<Id, string>();
  const refs = new Map<string, string>();
  for (const e of project.model.elements) {
    if (!Array.isArray(e.properties?.fields) && !dtoIds.has(e.id)) continue;
    const name = pascal(e.name);
    schemaName.set(e.id, name);
    refs.set(e.name.toLowerCase(), name);
    refs.set(name.toLowerCase(), name);
  }
  const used = new Set<Id>();
  const take = (id: Id) => {
    const queue = [id];
    while (queue.length) {
      const cur = queue.pop()!;
      if (used.has(cur) || !schemaName.has(cur)) continue;
      used.add(cur);
      for (const fl of (byId.get(cur)?.properties?.fields ?? []) as Field[]) {
        const target = refs.get(fl.type.replace(/\[\]$/, '').toLowerCase());
        const tid = target && [...schemaName].find(([, n]) => n === target)?.[0];
        if (tid) queue.push(tid);
      }
    }
  };
  const ref = (id: Id | undefined) => {
    if (!id || !schemaName.has(id)) return undefined;
    take(id);
    return { $ref: `#/components/schemas/${schemaName.get(id)}` };
  };

  const paths: Record<string, Record<string, unknown>> = {};
  let secured = false;
  for (const r of rows) {
    const path = r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const params: Record<string, unknown>[] = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    if (r.pagination === 'offset')
      params.push(
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
      );
    if (r.pagination === 'cursor')
      params.push(
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'cursor', in: 'query', schema: { type: 'string' } },
      );
    if (r.method === 'POST' && byId.get(r.id)?.properties?.idempotent === true)
      params.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string' },
      });
    const req = ref(r.request);
    const res = ref(r.response);
    const body = res && r.returnsList ? { type: 'array', items: res } : res;
    const responses: Record<string, unknown> = {};
    for (const code of r.statusCodes) {
      const ok = code >= 200 && code < 300 && code !== 204;
      responses[String(code)] = {
        description: STATUS_TEXT[code] ?? 'Response',
        ...(ok && body ? { content: { 'application/json': { schema: body } } } : {}),
      };
    }
    const op: Record<string, unknown> = {
      operationId: r.id.replace(/[.-](\w)/g, (_, c: string) => c.toUpperCase()),
      summary: r.name,
      ...(r.parentId ? { tags: [byId.get(r.parentId)?.name ?? r.parentId] } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(req
        ? { requestBody: { required: true, content: { 'application/json': { schema: req } } } }
        : {}),
      responses,
      ...(r.auth !== 'none' ? { security: [{ bearerAuth: [] }] } : {}),
      ...(r.roles.length ? { 'x-roles': r.roles } : {}),
      ...(byId.get(r.id)?.properties?.idempotent === true ? { 'x-idempotent': true } : {}),
    };
    if (r.auth !== 'none') secured = true;
    (paths[path] ??= {})[r.method.toLowerCase()] = op;
  }

  const schemas: Record<string, unknown> = {};
  for (const id of [...used].sort()) {
    const e = byId.get(id)!;
    const fields = (Array.isArray(e.properties?.fields) ? e.properties.fields : []) as Field[];
    const required = fields.filter((x) => x.required !== false).map((x) => x.name);
    schemas[schemaName.get(id)!] = {
      type: 'object',
      ...(e.description ? { description: e.description } : {}),
      properties: Object.fromEntries(fields.map((x) => [x.name, fieldSchema(x.type, refs)])),
      ...(required.length ? { required } : {}),
    };
  }
  const versions = [...new Set(rows.flatMap((r) => (r.version ? [r.version] : [])))];
  const doc = new Document({
    openapi: '3.1.0',
    info: {
      title: scope ? `${scope.name} API` : `${project.name} API`,
      version: versions[0] ?? '0.1.0',
      description: `Skeleton generated by archguide from the model of "${project.name}". Fill in descriptions and examples.`,
    },
    paths,
    components: {
      schemas,
      ...(secured
        ? {
            securitySchemes: {
              bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
            },
          }
        : {}),
    },
  });
  return doc.toString({ lineWidth: 0 });
}

// --- Mermaid sequence (scenarios) ------------------------------------------------------

const sid = (id: string) => id.replace(/\./g, '__').replace(/-/g, '_');
const stext = (text: string) => text.replace(/[;#]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * A scenario view as a Mermaid `sequenceDiagram` (§13.8): participants in order of first
 * use, one message per step (async relations as open arrows), step notes as notes.
 */
export function sequenceDiagram(f: Facts, view: View): string {
  const steps = view.scenario?.steps ?? [];
  const lines = ['sequenceDiagram', `  title ${stext(view.name)}`, '  autonumber'];
  const seen = new Set<Id>();
  const body: string[] = [];
  const participant = (id: Id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const e = f.graph.element(id);
    const word = e && f.graph.category(e) === 'actor' ? 'actor' : 'participant';
    lines.push(`  ${word} ${sid(id)} as ${stext(e?.name ?? id)}`);
  };
  for (const step of steps) {
    const r = f.graph.relation(step.relationId);
    if (!r) continue;
    participant(r.sourceId);
    participant(r.targetId);
    const type = f.catalog.relationTypes.get(r.type);
    const async = (r.mode ?? type?.mode) === 'async';
    const text = [type?.name ?? r.type, r.label].filter(Boolean).join(': ');
    body.push(`  ${sid(r.sourceId)}${async ? '-)' : '->>'}${sid(r.targetId)}: ${stext(text)}`);
    if (step.note?.trim())
      body.push(`  Note over ${sid(r.sourceId)},${sid(r.targetId)}: ${stext(step.note)}`);
  }
  return `${[...lines, ...body].join('\n')}\n`;
}
