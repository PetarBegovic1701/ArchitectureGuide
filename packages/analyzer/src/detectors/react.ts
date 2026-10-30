import { posix } from 'node:path';
import type { Fact } from '@archguide/core';
import type { Detector, DetectorContext } from '../context';
import { at } from '../context';
import type { Value } from '../engines/ts-index';
import { numbersIn, obj, text } from '../engines/ts-index';
import { codeFiles, hasDep, title } from './util';

const isReactApp = (ctx: DetectorContext) =>
  ctx.facts.some(
    (f) =>
      f.type === 'deployable' &&
      f.subject === ctx.pkgSubject(ctx.pkg) &&
      f.element?.kind === 'react.app',
  );

const routeName = (path: string) => (path === '/' ? 'Home' : path);
const joinPath = (base: string, path: string) =>
  path.startsWith('/') ? path : `${base.replace(/\/$/, '')}/${path}`.replace(/^\/\//, '/');

/** `react.router`: data routers, `<Route path>` elements, TanStack file routes. */
const router: Detector = {
  id: 'react.router',
  appliesTo: (p) => hasDep(p, 'react-router', 'react-router-dom', '@tanstack/react-router'),
  async run(ctx) {
    if (!isReactApp(ctx)) return [];
    const app = ctx.pkgSubject(ctx.pkg);
    const out: Fact[] = [];
    const add = (
      path: string,
      file: string,
      line: number,
      opts: { layout?: boolean; lazy?: boolean; parent?: string; name?: string },
    ) => {
      const subject = `${opts.layout ? 'layout' : 'route'}:${app}:${path}`;
      if (out.some((f) => f.subject === subject)) return subject;
      out.push({
        type: 'route',
        subject,
        data: { path, layout: Boolean(opts.layout) },
        evidence: [at(file, line)],
        confidence: 0.85,
        detector: 'react.router',
        element: {
          kind: opts.layout ? 'react.layout' : 'react.route',
          name: opts.name ?? (opts.layout ? `Layout ${path}` : routeName(path)),
          parent: opts.parent ?? app,
          properties: { path, ...(opts.lazy ? { lazy: true } : {}) },
        },
      });
      return subject;
    };
    const walk = (routes: Value, base: string, file: string, line: number, parent?: string) => {
      if (!Array.isArray(routes)) return;
      for (const r of routes) {
        const o = obj(r);
        if (!o) continue;
        const own = text(o.path);
        const path =
          o.index === true
            ? base || '/'
            : own !== undefined
              ? joinPath(base || '/', own)
              : base || '/';
        const children = Array.isArray(o.children) ? o.children : undefined;
        const lazy = Boolean(o.lazy);
        if (children?.length) {
          const tag =
            o.element && typeof o.element === 'object' && '$jsx' in o.element
              ? String(o.element.$jsx)
              : undefined;
          const layout = add(path, file, line, {
            layout: true,
            ...(parent ? { parent } : {}),
            ...(tag ? { name: title(tag) } : {}),
          });
          walk(children, path, file, line, layout);
        } else add(path, file, line, { lazy, ...(parent ? { parent } : {}) });
      }
    };
    for (const f of codeFiles(ctx)) {
      const index = await ctx.engines.index(f);
      if (!index) continue;
      for (const c of index.calls) {
        if (/^(createBrowserRouter|createHashRouter|createMemoryRouter|useRoutes)$/.test(c.callee))
          walk(c.args[0] ?? null, '', f, c.line);
        if (c.callee === 'createFileRoute' || c.callee === 'createRoute') {
          const path = text(c.args[0]) ?? text(obj(c.args[0])?.path);
          if (path) add(path, f, c.line, {});
        }
      }
      for (const j of index.jsx)
        if (j.tag === 'Route' && typeof j.attrs.path === 'string')
          add(joinPath('/', j.attrs.path), f, j.line, {});
    }
    return out;
  },
};

const FSD_LAYERS = ['app', 'pages', 'widgets', 'features', 'entities', 'shared'] as const;

/** `react.fsd`: Feature-Sliced Design folders; features and entities become `react.feature`. */
const fsd: Detector = {
  id: 'react.fsd',
  appliesTo: (p) => hasDep(p, 'react'),
  async run(ctx) {
    if (!isReactApp(ctx)) return [];
    const src = `${ctx.pkg.dir ? `${ctx.pkg.dir}/` : ''}src/`;
    const layers = new Map<string, Set<string>>();
    for (const f of ctx.files) {
      if (!f.startsWith(src)) continue;
      const [layer, slice] = f.slice(src.length).split('/');
      if (!layer || !(FSD_LAYERS as readonly string[]).includes(layer)) continue;
      const set = layers.get(layer) ?? new Set();
      if (slice && !slice.includes('.')) set.add(slice);
      layers.set(layer, set);
    }
    // Three FSD layers, one of them a slice layer, make it Feature-Sliced Design.
    if (layers.size < 3 || !['features', 'entities', 'widgets'].some((l) => layers.has(l)))
      return [];
    const app = ctx.pkgSubject(ctx.pkg);
    const out: Fact[] = [];
    for (const layer of FSD_LAYERS) {
      if (!layers.has(layer)) continue;
      out.push({
        type: 'layer-folder',
        subject: `fsd:${app}:${layer}`,
        data: {
          style: 'fsd',
          layer,
          app,
          folder: `${src}${layer}`,
          rank: FSD_LAYERS.indexOf(layer),
        },
        evidence: [at(`${src}${layer}`)],
        confidence: 0.8,
        detector: 'react.fsd',
      });
      if (layer !== 'features' && layer !== 'entities') continue;
      for (const slice of [...layers.get(layer)!].sort())
        out.push({
          type: 'module',
          subject: `slice:${app}:${layer}/${slice}`,
          data: { fsdLayer: layer, slice },
          evidence: [at(`${src}${layer}/${slice}`)],
          confidence: 0.75,
          detector: 'react.fsd',
          element: {
            kind: 'react.feature',
            name: title(slice),
            parent: app,
            codePaths: [`${src}${layer}/${slice}`],
            properties: { fsdLayer: layer, folder: `${layer}/${slice}` },
          },
        });
    }
    return out;
  },
};

const SERVER_STATE: [string, string][] = [
  ['@tanstack/react-query', 'tanstack-query'],
  ['swr', 'swr'],
  ['@apollo/client', 'apollo'],
];

/** `react.state`: the server-state cache, client stores, thunks and fetches inside stores. */
const state: Detector = {
  id: 'react.state',
  appliesTo: (p) => hasDep(p, 'react'),
  async run(ctx) {
    if (!isReactApp(ctx)) return [];
    const app = ctx.pkgSubject(ctx.pkg);
    const out: Fact[] = [];
    const files = codeFiles(ctx);
    for (const [dep, lib] of SERVER_STATE) {
      if (!ctx.pkg.deps.has(dep)) continue;
      const uses: { file: string; line: number }[] = [];
      for (const f of files) {
        const index = await ctx.engines.index(f);
        const c = index?.calls.find((x) =>
          /^(useQuery|useSuspenseQuery|useInfiniteQuery|useMutation|useSWR|QueryClient)$/.test(
            x.callee,
          ),
        );
        if (c) uses.push({ file: f, line: c.line });
      }
      if (!uses.length) continue;
      out.push({
        type: 'state',
        subject: `state:${app}:server`,
        data: { lib, role: 'server-state' },
        evidence: uses.slice(0, 5).map((u) => at(u.file, u.line)),
        confidence: 0.9,
        detector: 'react.state',
        element: {
          kind: 'react.server-state',
          name: lib === 'tanstack-query' ? 'Query cache' : `${title(lib)} cache`,
          parent: app,
          properties: { lib },
        },
      });
    }
    for (const f of files) {
      const index = await ctx.engines.index(f);
      if (!index) continue;
      for (const c of index.calls) {
        const zustand =
          c.callee === 'create' &&
          index.imports.some((i) => i.specifier === 'zustand' && i.names.includes('create'));
        const redux = c.callee === 'configureStore';
        const rtkQuery =
          c.callee === 'createApi' &&
          index.imports.some((i) => i.specifier.startsWith('@reduxjs/toolkit'));
        if (rtkQuery)
          out.push({
            type: 'state',
            subject: `state:${app}:server`,
            data: { lib: 'rtk-query', role: 'server-state' },
            evidence: [at(f, c.line)],
            confidence: 0.85,
            detector: 'react.state',
            element: {
              kind: 'react.server-state',
              name: 'RTK Query cache',
              parent: app,
              properties: { lib: 'rtk-query' },
            },
          });
        if (!zustand && !redux) continue;
        const binding = Object.entries(index.bindings).find(
          ([, callee]) => callee === c.callee,
        )?.[0];
        const base =
          binding?.replace(/^use/, '').replace(/Store$/, '') ||
          posix.basename(f).replace(/\.[jt]sx?$/, '');
        out.push({
          type: 'state',
          subject: `store:${app}:${f}`,
          data: { lib: zustand ? 'zustand' : 'redux', role: 'client-store', file: f },
          evidence: [at(f, c.line, binding)],
          confidence: 0.85,
          detector: 'react.state',
          element: {
            kind: 'react.client-store',
            name: redux ? 'Redux store' : `${title(base)} store`,
            parent: app,
            codePaths: [f],
            properties: { lib: zustand ? 'zustand' : 'redux' },
          },
        });
      }
      // RNP-012 signals: thunks and fetches inside store actions.
      for (const c of index.calls) {
        const thunk = c.callee === 'createAsyncThunk';
        const fetchInStore =
          /^(fetch|axios\.\w+|api\.\w+|http\.\w+|client\.\w+)$/.test(c.callee) &&
          c.inside.includes('create') &&
          index.imports.some((i) => i.specifier === 'zustand');
        if (thunk || fetchInStore)
          out.push({
            type: 'state',
            subject: `fetch-in-store:${f}:${c.line}`,
            data: { role: thunk ? 'async-thunk' : 'fetch-in-store', app, file: f },
            evidence: [at(f, c.line, c.callee)],
            confidence: 0.8,
            detector: 'react.state',
          });
      }
    }
    return out;
  },
};

/** `react.api-client`: axios instances, fetch wrappers, OpenAPI and tRPC clients. */
const apiClient: Detector = {
  id: 'react.api-client',
  appliesTo: (p) => hasDep(p, 'react'),
  async run(ctx) {
    if (!isReactApp(ctx)) return [];
    const app = ctx.pkgSubject(ctx.pkg);
    const out: Fact[] = [];
    for (const f of codeFiles(ctx)) {
      const index = await ctx.engines.index(f);
      if (!index) continue;
      for (const c of index.calls) {
        const kind =
          c.callee === 'axios.create'
            ? 'axios'
            : /^createTRPC(ProxyClient|React|Client)$/.test(c.callee)
              ? 'trpc'
              : c.callee === 'createClient' &&
                  index.imports.some((i) => i.specifier === 'openapi-fetch')
                ? 'openapi'
                : undefined;
        if (!kind) continue;
        const baseURL = text(obj(c.args[0])?.baseURL);
        out.push({
          type: 'api-client',
          subject: `apiclient:${app}:${f}`,
          data: { kind, ...(baseURL ? { baseURL } : {}) },
          evidence: [at(f, c.line, c.callee)],
          confidence: 0.85,
          detector: 'react.api-client',
          element: {
            kind: 'react.api-client',
            name: 'API client',
            parent: app,
            codePaths: [f],
            properties: { kind: kind === 'openapi' ? 'openapi-generated' : kind },
          },
        });
      }
      // A module that wraps fetch and exports it: src/api/*, src/lib/http*, *client*.
      if (
        /(^|\/)(api|http|lib\/(api|http|fetch))(\/|\.)|client\.[jt]s$/.test(f) &&
        index.exports.length &&
        index.calls.some((c) => c.callee === 'fetch')
      )
        if (!out.some((o) => o.subject === `apiclient:${app}:${f}`))
          out.push({
            type: 'api-client',
            subject: `apiclient:${app}:${f}`,
            data: { kind: 'fetch' },
            evidence: [at(f, index.calls.find((c) => c.callee === 'fetch')!.line, 'fetch')],
            confidence: 0.6,
            detector: 'react.api-client',
            element: {
              kind: 'react.api-client',
              name: 'API client',
              parent: app,
              codePaths: [f],
              properties: { kind: 'fetch' },
            },
          });
    }
    return out;
  },
};

/** Ports in a URL: "http://localhost:3000/x" → 3000. */
const portOf = (url: string | undefined) => {
  const m = url
    ? /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::(\d+))/.exec(url)
    : null;
  return m ? Number(m[1]) : undefined;
};

/**
 * `react.backend-link` (repository scope): the Vite proxy targets (read statically) and
 * `VITE_API_URL`-style variables, matched to a service by port (its `listen`, its PORT
 * variable or a compose port).
 */
const backendLink: Detector = {
  id: 'react.backend-link',
  scope: 'repo',
  async run(ctx) {
    const out: Fact[] = [];
    const apps = ctx.facts.filter(
      (f) => f.type === 'deployable' && f.element?.kind === 'react.app',
    );
    const services = ctx.facts.filter(
      (f) =>
        f.type === 'deployable' &&
        ['node.service', 'node.bff', 'py.service', 'dotnet.service'].includes(
          f.element?.kind ?? '',
        ),
    );
    if (!apps.length || !services.length) return out;
    const ports = await servicePorts(ctx, services);
    const env = await ctx.engines.env();
    for (const app of apps) {
      const p = ctx.packages.find((x) => ctx.pkgSubject(x) === app.subject)!;
      const base = p.dir ? `${p.dir}/` : '';
      const targets: { port: number; file: string; line: number; via: string }[] = [];
      for (const f of ctx.files.filter(
        (x) => x.startsWith(base) && /vite\.config\.[cm]?[jt]s$/.test(x),
      )) {
        const index = await ctx.engines.index(f);
        const config = index?.calls.find((c) => c.callee === 'defineConfig');
        const proxy = obj(obj(obj(config?.args[0])?.server)?.proxy);
        for (const [path, target] of Object.entries(proxy ?? {})) {
          const port = portOf(text(target) ?? text(obj(target)?.target));
          if (port) targets.push({ port, file: f, line: config!.line, via: `proxy ${path}` });
        }
      }
      for (const v of env.filter(
        (e) =>
          e.file.startsWith(base) &&
          /^(VITE|REACT_APP|NEXT_PUBLIC)_.*(API|BACKEND|SERVER)/.test(e.name),
      ))
        if (v.url?.port && ['localhost', '127.0.0.1'].includes(v.url.host))
          targets.push({ port: v.url.port, file: v.file, line: v.line, via: v.name });
      for (const t of targets) {
        const svc = ports.get(t.port);
        if (!svc) continue;
        out.push({
          type: 'http-call',
          subject: `call:${app.subject}->${svc.subject}`,
          data: { from: app.subject, to: svc.subject, port: t.port, via: t.via },
          evidence: [at(t.file, t.line, t.via), ...svc.evidence],
          confidence: 0.85,
          detector: 'react.backend-link',
          relation: { type: 'calls', from: app.subject, to: svc.subject, protocol: 'http' },
        });
      }
    }
    return out;
  },
};

/** Port → service, from `listen(3000)`, a PORT variable in the service's .env, or compose ports. */
export async function servicePorts(ctx: DetectorContext, services: readonly Fact[]) {
  const out = new Map<number, { subject: string; evidence: Fact['evidence'] }>();
  const env = await ctx.engines.env();
  const compose = await ctx.engines.compose();
  for (const s of services) {
    const p = ctx.packages.find((x) => ctx.pkgSubject(x) === s.subject);
    if (!p) continue;
    const base = p.dir ? `${p.dir}/` : '';
    for (const f of ctx.files.filter((x) => x.startsWith(base) && /\.(m|c)?[jt]s$/.test(x))) {
      const index = await ctx.engines.index(f);
      for (const c of index?.calls ?? []) {
        if (!/(^|\.)listen$/.test(c.callee)) continue;
        const port = numbersIn(c.args[0]).find((n) => n >= 80 && n < 65536) ?? NaN;
        if (Number.isFinite(port))
          out.set(port, { subject: s.subject, evidence: [at(f, c.line, 'listen')] });
      }
    }
    for (const v of env.filter((e) => e.file.startsWith(base) && e.name === 'PORT')) {
      const text = await ctx.engines.read(v.file);
      const m = text?.split('\n')[v.line - 1]?.match(/=\s*(\d{2,5})\s*$/);
      if (m) out.set(Number(m[1]), { subject: s.subject, evidence: [at(v.file, v.line, 'PORT')] });
    }
    for (const { file, services: list } of compose)
      for (const c of list) {
        const ctxDir = c.build
          ? posix.normalize(posix.join(posix.dirname(file), c.build))
          : undefined;
        if (ctxDir !== (p.dir || '.')) continue;
        for (const port of c.ports)
          out.set(port.host ?? port.container, {
            subject: s.subject,
            evidence: [at(file, c.line, c.name)],
          });
      }
  }
  return out;
}

export const REACT_DETECTORS: Detector[] = [router, fsd, state, apiClient, backendLink];
