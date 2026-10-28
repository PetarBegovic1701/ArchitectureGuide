import { LineCounter, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { Node as YamlNode } from 'yaml';

export interface ComposeService {
  name: string;
  line: number;
  image?: string;
  /** Build context, relative to the compose file. */
  build?: string;
  ports: { host?: number; container: number }[];
  dependsOn: string[];
  /** Names only (values are not kept). */
  environment: string[];
  /** Hosts and ports of URL-shaped environment values ("db:5432"), for matching services. */
  urls: { name: string; host: string; port?: number }[];
}

/** `docker-compose*.yml` services (Implementation.md §19.2 `compose`). */
export function parseCompose(text: string): { services: ComposeService[]; error?: string } {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  if (doc.errors.length) return { services: [], error: doc.errors[0]!.message };
  const services = doc.get('services', true) as YamlNode | undefined;
  if (!isMap(services)) return { services: [] };
  const out: ComposeService[] = [];
  for (const item of services.items) {
    const name = isScalar(item.key) ? String(item.key.value) : '?';
    const body = item.value;
    const line =
      item.key && isScalar(item.key) && item.key.range
        ? lineCounter.linePos(item.key.range[0]).line
        : 0;
    const svc: ComposeService = { name, line, ports: [], dependsOn: [], environment: [], urls: [] };
    if (isMap(body)) {
      const get = (key: string) => body.get(key, true) as YamlNode | undefined;
      const image = get('image');
      if (isScalar(image)) svc.image = String(image.value);
      const build = get('build');
      if (isScalar(build)) svc.build = String(build.value);
      if (isMap(build)) {
        const ctx = build.get('context', true);
        if (isScalar(ctx)) svc.build = String(ctx.value);
      }
      const ports = get('ports');
      if (isSeq(ports))
        for (const p of ports.items) {
          const s = isScalar(p) ? String(p.value) : '';
          const m = /^(?:(?:\d{1,3}\.){3}\d{1,3}:)?(?:(\d+):)?(\d+)(?:\/\w+)?$/.exec(
            s.replace(/"/g, ''),
          );
          if (m)
            svc.ports.push({ ...(m[1] ? { host: Number(m[1]) } : {}), container: Number(m[2]) });
        }
      const deps = get('depends_on');
      if (isSeq(deps))
        svc.dependsOn = deps.items.flatMap((d) => (isScalar(d) ? [String(d.value)] : []));
      if (isMap(deps))
        svc.dependsOn = deps.items.flatMap((d) => (isScalar(d.key) ? [String(d.key.value)] : []));
      const env = get('environment');
      const pairs: [string, string][] = [];
      if (isMap(env))
        for (const e of env.items)
          if (isScalar(e.key))
            pairs.push([String(e.key.value), isScalar(e.value) ? String(e.value.value ?? '') : '']);
      if (isSeq(env))
        for (const e of env.items)
          if (isScalar(e)) {
            const [k, ...v] = String(e.value).split('=');
            pairs.push([k!, v.join('=')]);
          }
      for (const [k, v] of pairs) {
        svc.environment.push(k);
        const url = urlShape(v);
        if (url) svc.urls.push({ name: k, ...url });
      }
    }
    out.push(svc);
  }
  return { services: out };
}

/** Host and port of a URL-shaped value; nothing else of the value is kept. */
export function urlShape(value: string): { host: string; port?: number } | undefined {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([a-z0-9.-]+)(?::(\d+))?/i.exec(value.trim());
  if (!m) return undefined;
  return { host: m[1]!.toLowerCase(), ...(m[2] ? { port: Number(m[2]) } : {}) };
}

export interface EnvVar {
  name: string;
  file: string;
  line: number;
  /** Host and port when the value is a URL; the value itself is never read into results. */
  url?: { host: string; port?: number };
}

/** `.env*` files: names, and the shape of URL values only (Implementation.md §19.2 `env`). */
export function parseEnv(file: string, text: string): EnvVar[] {
  const out: EnvVar[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m) return;
    const url = urlShape(m[2]!.replace(/^["']|["']$/g, ''));
    out.push({ name: m[1]!, file, line: i + 1, ...(url ? { url } : {}) });
  });
  return out;
}
