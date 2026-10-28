import { posix } from 'node:path';
import type { Fact } from '@archguide/core';
import type { Detector, DetectorContext } from '../context';
import { at } from '../context';
import type { FileIndex, Value } from '../engines/ts-index';
import { obj, ref, text } from '../engines/ts-index';
import { servicePorts } from './react';
import { codeFiles, deployablesFor, depEvidence, hasDep, title } from './util';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head'];
const VALIDATORS: [string, string][] = [
  ['zod', 'zod'],
  ['joi', 'joi'],
  ['celebrate', 'joi'],
  ['yup', 'yup'],
  ['express-validator', 'express-validator'],
  ['class-validator', 'class-validator'],
  ['@sinclair/typebox', 'typebox'],
  ['valibot', 'valibot'],
  ['@fastify/type-provider-zod', 'zod'],
  ['fastify-type-provider-zod', 'zod'],
  ['@fastify/type-provider-typebox', 'typebox'],
];

const deployableOf = (ctx: DetectorContext) =>
  ctx.facts.find(
    (f) =>
      f.type === 'deployable' &&
      f.subject === ctx.pkgSubject(ctx.pkg) &&
      f.element?.kind.startsWith('node.'),
  );

/**
 * The validation library a file uses: imported directly, or through a workspace package that
 * depends on one (shared zod contracts).
 */
const validationIn = (index: FileIndex, ctx: DetectorContext) => {
  const direct = VALIDATORS.find(([spec]) =>
    index.imports.some((i) => i.specifier === spec || i.specifier.startsWith(`${spec}/`)),
  )?.[1];
  if (direct) return direct;
  for (const i of index.imports) {
    const ws = ctx.packages.find(
      (p) => p.name === i.specifier || i.specifier.startsWith(`${p.name}/`),
    );
    const lib = ws && VALIDATORS.find(([spec]) => ws.deps.has(spec));
    if (lib) return lib[1];
  }
  return undefined;
};

const joinRoute = (prefix: string, path: string) =>
  `${prefix.replace(/\/$/, '')}/${path.replace(/^\//, '')}`.replace(/\/$/, '') || '/';

/** File → mount prefix, from `app.use('/p', router)` / `register(plugin, { prefix })`. */
async function mountPrefixes(ctx: DetectorContext, files: string[], kind: 'express' | 'fastify') {
  const graph = await ctx.engines.graph();
  const prefix = new Map<string, string>();
  for (const f of files) {
    const index = await ctx.engines.index(f);
    if (!index) continue;
    for (const c of index.calls) {
      let path: string | undefined;
      let target: Value | undefined;
      if (kind === 'express' && /\.use$/.test(c.callee) && typeof c.args[0] === 'string') {
        path = c.args[0];
        target = c.args[c.args.length - 1];
      }
      if (kind === 'fastify' && /\.register$/.test(c.callee)) {
        path = text(obj(c.args[1])?.prefix);
        target = c.args[0];
      }
      const name = ref(target);
      if (!path || !name) continue;
      const imp = index.imports.find(
        (i) => i.names.includes(name.split('.')[0]!) || (i.names.length === 0 && false),
      );
      const edge = imp && graph.out.get(f)?.find((e) => e.specifier === imp.specifier && e.to);
      if (edge?.to) prefix.set(edge.to, path);
    }
  }
  return prefix;
}

/** Route handlers of Express and Fastify: one `node.route-handler` per file that defines routes. */
const httpRoutes: Detector = {
  id: 'node.express',
  appliesTo: (p) => hasDep(p, 'express', 'fastify'),
  async run(ctx) {
    const service = deployableOf(ctx);
    if (!service) return [];
    const kind = ctx.pkg.deps.has('fastify') ? 'fastify' : 'express';
    const files = codeFiles(ctx);
    const prefixes = await mountPrefixes(ctx, files, kind);
    const out: Fact[] = [];
    for (const f of files) {
      const index = await ctx.engines.index(f);
      if (!index) continue;
      const routers = new Set(
        Object.entries(index.bindings)
          .filter(([, callee]) => /^(express\.)?Router$|^express$|^(fastify|Fastify)$/.test(callee))
          .map(([name]) => name),
      );
      if (kind === 'fastify')
        for (const n of ['app', 'fastify', 'server', 'instance', 'f']) routers.add(n);
      const routes: { method: string; path: string; line: number }[] = [];
      for (const c of index.calls) {
        const m = /^(\w+)\.(\w+)$/.exec(c.callee);
        if (!m || !routers.has(m[1]!)) continue;
        const method = m[2]!;
        if (METHODS.includes(method) && typeof c.args[0] === 'string' && c.args[0].startsWith('/'))
          routes.push({ method: method.toUpperCase(), path: c.args[0], line: c.line });
        if (kind === 'fastify' && method === 'route') {
          const o = obj(c.args[0]);
          const url = text(o?.url);
          const methods = Array.isArray(o?.method)
            ? o.method.map(String)
            : [String(o?.method ?? 'GET')];
          if (url)
            for (const x of methods)
              routes.push({ method: x.toUpperCase(), path: url, line: c.line });
        }
      }
      if (!routes.length) continue;
      const prefix = prefixes.get(f) ?? '';
      const base = posix.basename(f).replace(/\.(m|c)?[jt]sx?$/, '');
      const name = base === 'index' || base === 'routes' ? posix.basename(posix.dirname(f)) : base;
      const validation = validationIn(index, ctx);
      const subject = `handler:${f}`;
      out.push({
        type: 'handler',
        subject,
        data: {
          framework: kind,
          file: f,
          validation: validation ?? null,
          routes: routes.map((r) => `${r.method} ${joinRoute(prefix, r.path)}`),
        },
        evidence: routes.slice(0, 5).map((r) => at(f, r.line, `${r.method} ${r.path}`)),
        confidence: 0.85,
        detector: kind === 'fastify' ? 'node.fastify' : 'node.express',
        element: {
          kind: 'node.route-handler',
          name: /^(main|server|app|index)$/.test(name)
            ? `${service.element!.name} routes`
            : `${title(name)} routes`,
          parent: service.subject,
          codePaths: [f],
          properties: {
            routes: routes.map((r) => `${r.method} ${joinRoute(prefix, r.path)}`),
            ...(validation ? { validation } : {}),
          },
        },
      });
    }
    return out;
  },
};

/** `node.nest`: modules and their imports, controllers with their routes. */
const nest: Detector = {
  id: 'node.nest',
  appliesTo: (p) => hasDep(p, '@nestjs/core', '@nestjs/common'),
  async run(ctx) {
    const service = deployableOf(ctx);
    if (!service) return [];
    const out: Fact[] = [];
    const modules = new Map<
      string,
      { subject: string; file: string; line: number; imports: Value[]; controllers: string[] }
    >();
    const controllers: {
      cls: string;
      file: string;
      line: number;
      prefix: string;
      routes: { method: string; path: string; line: number }[];
      validation?: string;
    }[] = [];
    for (const f of codeFiles(ctx)) {
      const index = await ctx.engines.index(f);
      if (!index) continue;
      for (const d of index.decorators) {
        if (d.name === 'Module' && d.targetKind === 'class') {
          const o = obj(d.args[0]) ?? {};
          modules.set(d.target, {
            subject: `module:${posix.dirname(f)}`,
            file: f,
            line: d.line,
            imports: Array.isArray(o.imports) ? o.imports : [],
            controllers: (Array.isArray(o.controllers) ? o.controllers : []).flatMap((c) =>
              ref(c) ? [ref(c)!] : [],
            ),
          });
        }
        if (d.name === 'Controller' && d.targetKind === 'class') {
          const prefix = text(d.args[0]) ?? text(obj(d.args[0])?.path) ?? '';
          const routes = index.decorators
            .filter(
              (x) =>
                x.className === d.target &&
                x.targetKind === 'method' &&
                /^(Get|Post|Put|Patch|Delete|All|Options|Head)$/.test(x.name),
            )
            .map((x) => ({
              method: x.name.toUpperCase(),
              path: joinRoute(`/${prefix}`, text(x.args[0]) ?? ''),
              line: x.line,
            }));
          controllers.push({
            cls: d.target,
            file: f,
            line: d.line,
            prefix,
            routes,
            ...(validationIn(index, ctx) ? { validation: validationIn(index, ctx)! } : {}),
          });
        }
      }
    }
    const root = [...modules.entries()].find(([cls]) => cls === 'AppModule')?.[1]?.subject;
    for (const [cls, m] of modules) {
      if (cls === 'AppModule' || m.subject === root) continue;
      out.push({
        type: 'module',
        subject: m.subject,
        data: { framework: 'nest', className: cls },
        evidence: [at(m.file, m.line, cls)],
        confidence: 0.9,
        detector: 'node.nest',
        element: {
          kind: 'node.module',
          name: title(cls.replace(/Module$/, '')),
          parent: service.subject,
          codePaths: [posix.dirname(m.file)],
        },
      });
      for (const imp of m.imports) {
        // forwardRef(() => OtherModule) is a hint of a cycle between the modules.
        const forward =
          imp && typeof imp === 'object' && '$call' in imp && imp.$call === 'forwardRef';
        const name = ref(imp) ?? (forward ? 'forwardRef' : undefined);
        const target = name ? modules.get(name) : undefined;
        if (target && target.subject !== root)
          out.push({
            type: 'import',
            subject: `${m.subject}->${target.subject}`,
            data: { from: m.subject, to: target.subject, nest: true },
            evidence: [at(m.file, m.line, name)],
            confidence: 0.9,
            detector: 'node.nest',
            relation: { type: 'depends-on', from: m.subject, to: target.subject },
          });
      }
    }
    for (const c of controllers) {
      const owner = [...modules.entries()].find(
        ([cls, m]) => cls !== 'AppModule' && m.controllers.includes(c.cls),
      )?.[1];
      out.push({
        type: 'handler',
        subject: `handler:${c.file}`,
        data: {
          framework: 'nest',
          file: c.file,
          validation: c.validation ?? null,
          routes: c.routes.map((r) => `${r.method} ${r.path}`),
        },
        evidence: [at(c.file, c.line, c.cls)],
        confidence: 0.9,
        detector: 'node.nest',
        element: {
          kind: 'node.route-handler',
          name: `${title(c.cls.replace(/Controller$/, ''))} controller`,
          parent: owner && owner.subject !== root ? owner.subject : service.subject,
          codePaths: [c.file],
          properties: {
            routes: c.routes.map((r) => `${r.method} ${r.path}`),
            ...(c.validation ? { validation: c.validation } : {}),
          },
        },
      });
    }
    return out;
  },
};

const AUTH: { dep: string; method: string; provider?: string }[] = [
  { dep: 'passport', method: 'session' },
  { dep: 'passport-jwt', method: 'jwt' },
  { dep: 'express-jwt', method: 'jwt' },
  { dep: 'jsonwebtoken', method: 'jwt' },
  { dep: 'jose', method: 'jwt' },
  { dep: '@nestjs/passport', method: 'jwt' },
  { dep: '@nestjs/jwt', method: 'jwt' },
  { dep: '@fastify/jwt', method: 'jwt' },
  { dep: 'express-session', method: 'session' },
  { dep: '@clerk/express', method: 'oidc', provider: 'Clerk' },
  { dep: '@clerk/fastify', method: 'oidc', provider: 'Clerk' },
  { dep: '@clerk/backend', method: 'oidc', provider: 'Clerk' },
  { dep: 'express-oauth2-jwt-bearer', method: 'oidc', provider: 'Auth0' },
  { dep: '@auth0/auth0-react', method: 'oidc', provider: 'Auth0' },
  { dep: '@supabase/supabase-js', method: 'jwt', provider: 'Supabase Auth' },
  { dep: 'firebase-admin', method: 'jwt', provider: 'Firebase Auth' },
];

/** `node.middleware`: authentication middleware, and the identity provider behind it. */
const middleware: Detector = {
  id: 'node.middleware',
  appliesTo: (p) => AUTH.some((a) => p.deps.has(a.dep)),
  async run(ctx) {
    const service = deployableOf(ctx);
    if (!service) return [];
    const out: Fact[] = [];
    const found = AUTH.filter((a) => ctx.pkg.deps.has(a.dep));
    const evidence = await Promise.all(found.map((a) => depEvidence(ctx, ctx.pkg, a.dep)));
    out.push({
      type: 'middleware',
      subject: `mw:${service.subject}:auth`,
      data: { kind: 'auth', libs: found.map((a) => a.dep) },
      evidence,
      confidence: 0.75,
      detector: 'node.middleware',
      element: {
        kind: 'node.middleware',
        name: 'Auth middleware',
        parent: service.subject,
        properties: { kind: 'auth', authMethod: found[0]!.method },
      },
    });
    for (const a of found.filter((x) => x.provider)) {
      const subject = `idp:${a.provider}`;
      out.push({
        type: 'external-sdk',
        subject,
        data: { provider: a.provider },
        evidence: [await depEvidence(ctx, ctx.pkg, a.dep)],
        confidence: 0.8,
        detector: 'node.middleware',
        element: { kind: 'gen.auth-provider', name: a.provider! },
      });
      out.push({
        type: 'external-sdk',
        subject: `${service.subject}->${subject}`,
        data: {},
        evidence: [await depEvidence(ctx, ctx.pkg, a.dep)],
        confidence: 0.8,
        detector: 'node.middleware',
        relation: { type: 'authenticates-with', from: service.subject, to: subject },
      });
    }
    return out;
  },
};

const SDKS: [RegExp, string][] = [
  [/^stripe$/, 'Stripe'],
  [/^@sendgrid\//, 'SendGrid'],
  [/^@aws-sdk\//, 'AWS'],
  [/^@anthropic-ai\/sdk$/, 'Anthropic API'],
  [/^openai$/, 'OpenAI API'],
  [/^twilio$/, 'Twilio'],
  [/^resend$/, 'Resend'],
  [/^@slack\/web-api$/, 'Slack'],
  [/^@google-cloud\//, 'Google Cloud'],
  [/^@paypal\//, 'PayPal'],
  [/^postmark$/, 'Postmark'],
  [/^algoliasearch$/, 'Algolia'],
  [/^@sentry\/node$/, 'Sentry'],
];

/** `node.external-sdk`: third-party APIs a deployable calls (from its imports). */
const externalSdk: Detector = {
  id: 'node.external-sdk',
  appliesTo: (p) => [...p.deps].some((d) => SDKS.some(([re]) => re.test(d))),
  async run(ctx) {
    const owners = deployablesFor(ctx, ctx.pkg);
    if (!owners.length) return [];
    const out: Fact[] = [];
    for (const f of codeFiles(ctx)) {
      const index = await ctx.engines.index(f);
      for (const imp of index?.imports ?? []) {
        const sdk = SDKS.find(([re]) => re.test(imp.specifier));
        if (!sdk || imp.typeOnly) continue;
        const subject = `ext:${sdk[1]}`;
        out.push({
          type: 'external-sdk',
          subject,
          data: { sdk: imp.specifier },
          evidence: [at(f, imp.line, imp.specifier)],
          confidence: 0.85,
          detector: 'node.external-sdk',
          element: { kind: 'gen.external', name: sdk[1] },
        });
        for (const owner of owners)
          out.push({
            type: 'external-sdk',
            subject: `${owner}->${subject}`,
            data: { sdk: imp.specifier },
            evidence: [at(f, imp.line, imp.specifier)],
            confidence: 0.85,
            detector: 'node.external-sdk',
            relation: { type: 'calls', from: owner, to: subject, protocol: 'https' },
          });
      }
    }
    return out;
  },
};

/** Environment variable names a call's arguments read: `${process.env.ORDERS_URL}/x`. */
function envNames(args: Value[]): string[] {
  const json = JSON.stringify(args);
  return [...new Set([...json.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]!))];
}

/**
 * `node.http-calls` (repository scope): `fetch` / axios calls with a base URL from an
 * environment variable that points at another service (compose host, localhost port, or a
 * name like ORDERS_URL for the "orders" service).
 */
const httpCalls: Detector = {
  id: 'node.http-calls',
  scope: 'repo',
  async run(ctx) {
    const services = ctx.facts.filter(
      (f) => f.type === 'deployable' && f.element?.kind.startsWith('node.'),
    );
    if (services.length < 2) return [];
    const ports = await servicePorts(ctx, services);
    const env = await ctx.engines.env();
    const compose = await ctx.engines.compose();
    const byHost = new Map<string, string>();
    for (const { file, services: list } of compose)
      for (const c of list) {
        const dir = c.build ? posix.normalize(posix.join(posix.dirname(file), c.build)) : undefined;
        const svc = services.find(
          (s) => ctx.packages.find((p) => ctx.pkgSubject(p) === s.subject)?.dir === dir,
        );
        if (svc) byHost.set(c.name.toLowerCase(), svc.subject);
      }
    const composeUrls = compose.flatMap((c) =>
      c.services.flatMap((s) => s.urls.map((u) => ({ ...u, file: c.file, line: s.line }))),
    );
    const out: Fact[] = [];
    for (const from of services) {
      const p = ctx.packages.find((x) => ctx.pkgSubject(x) === from.subject);
      if (!p) continue;
      const base = p.dir ? `${p.dir}/` : '';
      for (const f of ctx.files.filter((x) => x.startsWith(base) && /\.(m|c)?[jt]s$/.test(x))) {
        const index = await ctx.engines.index(f);
        for (const c of index?.calls ?? []) {
          if (!/^(fetch|axios(\.\w+)?|got|ky|undici\.request|request)$/.test(c.callee)) continue;
          for (const name of envNames(c.args)) {
            const value =
              env.find((e) => e.name === name && e.url) ?? composeUrls.find((u) => u.name === name);
            const url =
              value && 'url' in value
                ? value.url
                : (value as { host?: string; port?: number } | undefined);
            let to: string | undefined;
            if (url?.host && byHost.has(url.host)) to = byHost.get(url.host);
            if (!to && url?.port && ['localhost', '127.0.0.1'].includes(url.host ?? ''))
              to = ports.get(url.port)?.subject;
            if (!to) {
              const stem = name
                .replace(/_(SERVICE_)?(API_)?(URL|HOST|BASE_URL|ORIGIN)$/, '')
                .toLowerCase()
                .replace(/_/g, '-');
              to = services.find(
                (s) =>
                  posix.basename(
                    ctx.packages.find((q) => ctx.pkgSubject(q) === s.subject)?.dir ?? '',
                  ) === stem,
              )?.subject;
            }
            if (!to || to === from.subject) continue;
            out.push({
              type: 'http-call',
              subject: `call:${from.subject}->${to}`,
              data: { from: from.subject, to, env: name },
              evidence: [at(f, c.line, name)],
              confidence: 0.75,
              detector: 'node.http-calls',
              relation: { type: 'calls', from: from.subject, to, protocol: 'http' },
            });
          }
        }
      }
    }
    return out;
  },
};

const LAYER_KINDS: Record<string, { kind?: string; name: string }> = {
  domain: { kind: 'node.domain', name: 'Domain' },
  ports: { kind: 'node.port', name: 'Ports' },
  repositories: { kind: 'node.repository', name: 'Repositories' },
  'use-cases': { kind: 'node.use-case', name: 'Use cases' },
  usecases: { kind: 'node.use-case', name: 'Use cases' },
  application: { kind: 'node.use-case', name: 'Application' },
  adapters: { name: 'Adapters' },
  infra: { name: 'Infrastructure' },
  infrastructure: { name: 'Infrastructure' },
  controllers: { name: 'Controllers' },
};

/**
 * `node.layers`: layer folders (domain, ports, repositories, use cases, adapters …) and,
 * without NestJS, module folders under `src/modules/`.
 */
const layers: Detector = {
  id: 'node.layers',
  async run(ctx) {
    const service = deployableOf(ctx);
    if (!service) return [];
    const src = `${ctx.pkg.dir ? `${ctx.pkg.dir}/` : ''}src/`;
    const out: Fact[] = [];
    const folders = new Set<string>();
    for (const f of codeFiles(ctx)) {
      if (!f.startsWith(src)) continue;
      const parts = f.slice(src.length).split('/');
      for (let i = 0; i < parts.length - 1 && i < 4; i++)
        if (LAYER_KINDS[parts[i]!]) folders.add(src + parts.slice(0, i + 1).join('/'));
      if (parts[0] === 'modules' && parts.length > 2) folders.add(`${src}modules/${parts[1]}`);
    }
    const modules = new Set(
      ctx.facts
        .filter((f) => f.type === 'module' && f.subject.startsWith('module:'))
        .map((f) => f.subject),
    );
    for (const folder of [...folders].sort()) {
      const name = posix.basename(folder);
      if (folder.startsWith(`${src}modules/`) && posix.dirname(folder) === `${src}modules`) {
        const subject = `module:${folder}`;
        if (!modules.has(subject)) {
          modules.add(subject);
          out.push({
            type: 'module',
            subject,
            data: { folder },
            evidence: [at(folder)],
            confidence: 0.7,
            detector: 'node.layers',
            element: {
              kind: 'node.module',
              name: title(name),
              parent: service.subject,
              codePaths: [folder],
            },
          });
        }
        continue;
      }
      const layer = LAYER_KINDS[name]!;
      const parentModule = [...modules]
        .filter((m) => folder.startsWith(`${m.slice('module:'.length)}/`))
        .sort((a, b) => b.length - a.length)[0];
      out.push({
        type: 'layer-folder',
        subject: `layer:${folder}`,
        data: {
          style: 'node',
          layer: name,
          folder,
          service: service.subject,
          ...(parentModule ? { module: parentModule } : {}),
        },
        evidence: [at(folder)],
        confidence: 0.75,
        detector: 'node.layers',
        ...(layer.kind
          ? {
              element: {
                kind: layer.kind,
                name: parentModule
                  ? `${title(posix.basename(parentModule))} ${layer.name.toLowerCase()}`
                  : layer.name,
                parent: parentModule ?? service.subject,
                codePaths: [folder],
              },
            }
          : {}),
      });
    }
    return out;
  },
};

export const NODE_DETECTORS: Detector[] = [
  nest,
  layers,
  httpRoutes,
  middleware,
  externalSdk,
  httpCalls,
];
