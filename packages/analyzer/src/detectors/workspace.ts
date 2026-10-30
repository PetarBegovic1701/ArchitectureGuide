import type { Fact } from '@archguide/core';
import type { Detector, DetectorContext } from '../context';
import { at } from '../context';
import { manifestOf } from '../discover';
import { codeFiles, depEvidence, hasDep, languageProp, shortName, title } from './util';

const HTTP_FRAMEWORKS = ['express', 'fastify', '@nestjs/core', 'koa', 'hono', '@hapi/hapi'];

/** `ws.packages`: one fact per workspace package. */
const packages: Detector = {
  id: 'ws.packages',
  async run(ctx) {
    const file = manifestOf(ctx.pkg);
    return [
      {
        type: 'package',
        subject: ctx.pkgSubject(ctx.pkg),
        data: {
          name: ctx.pkg.name,
          dir: ctx.pkg.dir,
          language: ctx.pkg.language ?? 'js',
          deps: [...ctx.pkg.deps].sort(),
        },
        evidence: [at(file, 1)],
        confidence: 1,
        detector: 'ws.packages',
      },
    ];
  },
};

/** `ws.react-app`: React with Vite (or another bundler), an index.html or a Vite config. */
const reactApp: Detector = {
  id: 'ws.react-app',
  appliesTo: (p) =>
    hasDep(p, 'react') && hasDep(p, 'vite', 'react-scripts', 'next', '@remix-run/react', 'webpack'),
  async run(ctx) {
    const p = ctx.pkg;
    const base = p.dir ? `${p.dir}/` : '';
    const viteConfig = ctx.files.find(
      (f) => f.startsWith(base) && /\/?vite\.config\.[cm]?[jt]s$/.test(f),
    );
    const html = ctx.files.find((f) => f === `${base}index.html`);
    const bundler = hasDep(p, 'vite')
      ? 'vite'
      : hasDep(p, 'next')
        ? 'next'
        : hasDep(p, 'webpack', 'react-scripts')
          ? 'webpack'
          : undefined;
    const router = hasDep(p, '@tanstack/react-router')
      ? 'tanstack-router'
      : hasDep(p, 'react-router', 'react-router-dom')
        ? 'react-router'
        : undefined;
    const evidence = [await depEvidence(ctx, p, 'react')];
    if (viteConfig) evidence.push(at(viteConfig, 1));
    if (html) evidence.push(at(html, 1));
    return [
      {
        type: 'deployable',
        subject: ctx.pkgSubject(p),
        data: { role: 'react-app', bundler },
        evidence,
        confidence: viteConfig || html ? 0.9 : 0.7,
        detector: 'ws.react-app',
        element: {
          kind: 'react.app',
          name: title(shortName(p)),
          codePaths: [p.dir || '.'],
          tech: ['React', bundler === 'vite' ? 'Vite' : bundler === 'next' ? 'Next.js' : undefined]
            .filter(Boolean)
            .join(' + '),
          properties: { ...(bundler ? { bundler } : {}), ...(router ? { router } : {}) },
        },
      },
    ];
  },
};

/** Whether a call starts an HTTP server: `app.listen(`, `NestFactory.create(`, `serve(`. */
async function listenCall(ctx: DetectorContext) {
  for (const f of codeFiles(ctx)) {
    const index = await ctx.engines.index(f);
    const call = index?.calls.find(
      (c) =>
        /(^|\.)listen$/.test(c.callee) ||
        c.callee === 'NestFactory.create' ||
        (c.callee === 'serve' && index.imports.some((i) => i.specifier.startsWith('@hono/'))),
    );
    if (call) return { file: f, call };
  }
  return undefined;
}

/** `ws.node-service` and `ws.worker`: deployable Node packages. */
const nodeDeployable: Detector = {
  id: 'ws.node-service',
  appliesTo: (p) => !hasDep(p, 'react') || hasDep(p, ...HTTP_FRAMEWORKS),
  async run(ctx) {
    const p = ctx.pkg;
    const framework = HTTP_FRAMEWORKS.find((d) => p.deps.has(d));
    const listen = framework ? await listenCall(ctx) : undefined;
    const jobLib = hasDep(p, 'pg-boss')
      ? 'pg-boss'
      : hasDep(p, 'graphile-worker')
        ? 'graphile-worker'
        : hasDep(p, 'bullmq')
          ? 'bullmq'
          : undefined;
    let consumes: { file: string; line: number } | undefined;
    if (jobLib) {
      for (const f of codeFiles(ctx)) {
        const index = await ctx.engines.index(f);
        const c = index?.calls.find(
          (x) =>
            /\.work$/.test(x.callee) ||
            (jobLib === 'graphile-worker' && x.callee === 'run') ||
            (x.new && x.callee === 'Worker' && jobLib === 'bullmq'),
        );
        if (c) {
          consumes = { file: f, line: c.line };
          break;
        }
      }
    }
    const name = shortName(p);
    const fw = framework === '@nestjs/core' ? 'nestjs' : framework;
    if (listen && framework) {
      const bff = /(^|[-_/])(bff|gateway|edge)([-_/]|$)/i.test(`${p.dir}/${p.name}`);
      return [
        {
          type: 'deployable',
          subject: ctx.pkgSubject(p),
          data: { role: bff ? 'bff' : 'service', framework: fw },
          evidence: [
            await depEvidence(ctx, p, framework),
            at(listen.file, listen.call.line, listen.call.callee),
          ],
          confidence: 0.9,
          detector: 'ws.node-service',
          element: {
            kind: bff ? 'node.bff' : 'node.service',
            name: title(name),
            codePaths: [p.dir || '.'],
            tech: `Node.js + ${fw === 'nestjs' ? 'NestJS' : title(fw!)}`,
            properties: { framework: fw, runtime: 'node' },
          },
        },
      ];
    }
    if (consumes && jobLib) {
      return [
        {
          type: 'deployable',
          subject: ctx.pkgSubject(p),
          data: { role: 'worker', jobLib },
          evidence: [await depEvidence(ctx, p, jobLib), at(consumes.file, consumes.line)],
          confidence: 0.85,
          detector: 'ws.worker',
          element: {
            kind: 'node.worker',
            name: title(name),
            codePaths: [p.dir || '.'],
            tech: `Node.js + ${jobLib}`,
            properties: { jobLib },
          },
        },
      ];
    }
    return [];
  },
};

/**
 * `ws.libs` (repository scope): packages other packages import that are not deployable.
 * Contracts (zod, OpenAPI, tRPC), design systems (React components), shared libraries.
 */
const libs: Detector = {
  id: 'ws.libs',
  scope: 'repo',
  async run(ctx) {
    const deployables = new Set(
      ctx.facts.filter((f) => f.type === 'deployable').map((f) => f.subject),
    );
    const graph = await ctx.engines.graph();
    const out: Fact[] = [];
    for (const p of ctx.packages) {
      const subject = ctx.pkgSubject(p);
      // Python and .NET libraries: lang.libs.
      if (deployables.has(subject) || !p.dir || (p.language ?? 'js') !== 'js') continue;
      const importers = new Map<string, { file: string; line: number }>();
      for (const e of graph.edges) {
        if (!e.to || !e.to.startsWith(`${p.dir}/`)) continue;
        const from = ctx.packageOf(e.from);
        if (from && from !== p && !importers.has(ctx.pkgSubject(from)))
          importers.set(ctx.pkgSubject(from), { file: e.from, line: e.line });
      }
      // Also packages that only declare the dependency.
      for (const q of ctx.packages)
        if (q !== p && q.deps.has(p.name) && !importers.has(ctx.pkgSubject(q)))
          importers.set(ctx.pkgSubject(q), {
            file: manifestOf(q),
            line: 0,
          });
      if (importers.size === 0) continue;
      const contract =
        p.deps.has('zod') ||
        p.deps.has('@trpc/server') ||
        ctx.files.some((f) => f.startsWith(`${p.dir}/`) && /openapi\.(ya?ml|json)$/.test(f));
      const ui = p.deps.has('react');
      const kind =
        contract && !ui ? 'node.contract' : ui ? 'react.design-system' : 'node.shared-lib';
      out.push({
        type: 'package',
        subject,
        data: { role: 'library' },
        evidence: [
          at(manifestOf(p), 1),
          ...[...importers.values()].slice(0, 3).map((i) => at(i.file, i.line || undefined)),
        ],
        confidence: 0.8,
        detector: 'ws.libs',
        element: {
          kind,
          name: title(shortName(p)),
          codePaths: [p.dir],
          properties:
            kind === 'node.contract'
              ? { kind: p.deps.has('@trpc/server') ? 'trpc' : 'zod' }
              : { package: p.name, ...languageProp(p) },
        },
      });
      for (const [from, ev] of importers)
        if (deployables.has(from))
          out.push({
            type: 'import',
            subject: `${from}->${subject}`,
            data: { from, to: subject },
            evidence: [at(ev.file, ev.line || undefined)],
            confidence: 0.8,
            detector: 'ws.libs',
            relation: { type: 'depends-on', from, to: subject },
          });
    }
    return out;
  },
};

/** Deployables of npm packages; the libraries detector runs after every language's deployables. */
export const WORKSPACE_DETECTORS: Detector[] = [packages, reactApp, nodeDeployable];
export const WORKSPACE_LIBS: Detector[] = [libs];
