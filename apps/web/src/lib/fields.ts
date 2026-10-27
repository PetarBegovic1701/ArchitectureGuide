import { z } from 'zod';
import type { ZodType } from 'zod';

/** One input of a generated property form (Implementation.md §13.4). */
export type Field =
  | { key: string; label: string; kind: 'enum'; options: string[] }
  | { key: string; label: string; kind: 'enum-list'; options: string[] }
  | { key: string; label: string; kind: 'boolean' }
  | { key: string; label: string; kind: 'number'; integer: boolean; min?: number }
  | { key: string; label: string; kind: 'string' }
  | { key: string; label: string; kind: 'string-list' }
  | { key: string; label: string; kind: 'json' };

interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  minimum?: number;
  exclusiveMinimum?: number;
  anyOf?: JsonSchema[];
}

const ACRONYMS: Record<string, string> = {
  rls: 'RLS',
  id: 'ID',
  url: 'URL',
  api: 'API',
  sla: 'SLA',
  ms: '(ms)',
};

/** "poolSize" → "Pool size", "rls" → "RLS", "staleTimeMs" → "Stale time (ms)". */
export function labelFor(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(' ')
    .map((w) => ACRONYMS[w] ?? w);
  const text = words.join(' ');
  return /^[A-Z(]/.test(text) ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** Form fields from a concept's or relation type's Zod property schema, via JSON Schema. */
export function fieldsFor(schema: ZodType | undefined): Field[] {
  if (!schema) return [];
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
  return Object.entries(json.properties ?? {}).map(([key, prop]) => fieldFor(key, unwrap(prop)));
}

function unwrap(s: JsonSchema): JsonSchema {
  return s.anyOf?.find((x) => x.type !== 'null') ?? s;
}

function fieldFor(key: string, s: JsonSchema): Field {
  const label = labelFor(key);
  if (s.enum) return { key, label, kind: 'enum', options: s.enum.map(String) };
  switch (s.type) {
    case 'boolean':
      return { key, label, kind: 'boolean' };
    case 'integer':
    case 'number': {
      const min =
        s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : undefined);
      return {
        key,
        label,
        kind: 'number',
        integer: s.type === 'integer',
        ...(min !== undefined ? { min } : {}),
      };
    }
    case 'string':
      return { key, label, kind: 'string' };
    case 'array': {
      const items = s.items ? unwrap(s.items) : {};
      if (items.enum) return { key, label, kind: 'enum-list', options: items.enum.map(String) };
      if (items.type === 'string') return { key, label, kind: 'string-list' };
      return { key, label, kind: 'json' };
    }
    default:
      return { key, label, kind: 'json' };
  }
}
