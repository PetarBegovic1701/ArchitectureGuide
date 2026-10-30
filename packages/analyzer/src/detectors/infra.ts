import { posix } from 'node:path';
import type { Fact } from '@archguide/core';
import type { Detector } from '../context';
import { at } from '../context';
import { packageName } from '../engines/graph';
import { DATABASE } from './pg';

/** `infra.compose`: Postgres clusters, poolers and the services they serve. */
const compose: Detector = {
  id: 'infra.compose',
  scope: 'repo',
  async run(ctx) {
    const out: Fact[] = [];
    const deployables = ctx.facts.filter((f) => f.type === 'deployable');
    const clusters: string[] = [];
    for (const { file, services } of await ctx.engines.compose()) {
      for (const s of services) {
        const image = s.image ?? '';
        const dir = s.build ? posix.normalize(posix.join(posix.dirname(file), s.build)) : undefined;
        const deployable = dir
          ? deployables.find(
              (d) =>
                ctx.packages.find((p) => ctx.pkgSubject(p) === d.subject)?.dir ===
                (dir === '.' ? '' : dir),
            )
          : undefined;
        out.push({
          type: 'compose-service',
          subject: `compose:${s.name}`,
          data: {
            name: s.name,
            image: s.image ?? null,
            dir: dir ?? null,
            ports: s.ports,
            dependsOn: s.dependsOn,
            deployable: deployable?.subject ?? null,
          },
          evidence: [at(file, s.line, s.name)],
          confidence: 0.9,
          detector: 'infra.compose',
        });
        if (
          /(^|\/)(postgres|postgis\/postgis|timescale\/timescaledb|supabase\/postgres)(:|$)/.test(
            image,
          )
        ) {
          const subject = `cluster:${s.name}`;
          clusters.push(subject);
          const version = /:(\d+(\.\d+)?)/.exec(image)?.[1];
          out.push({
            type: 'compose-service',
            subject,
            data: { image },
            evidence: [at(file, s.line, image)],
            confidence: 0.9,
            detector: 'infra.compose',
            element: {
              kind: 'pg.cluster',
              name: 'PostgreSQL',
              ...(version
                ? { properties: { version, hosting: 'self' } }
                : { properties: { hosting: 'self' } }),
            },
          });
        }
        if (/(^|\/)(pgbouncer|edoburu\/pgbouncer|bitnami\/pgbouncer|pgcat)/.test(image)) {
          const subject = `pooler:${s.name}`;
          out.push({
            type: 'compose-service',
            subject,
            data: { image },
            evidence: [at(file, s.line, image)],
            confidence: 0.9,
            detector: 'infra.compose',
            element: {
              kind: 'pg.pooler',
              name: s.name === 'pgbouncer' ? 'PgBouncer' : s.name,
              properties: { kind: image.includes('pgcat') ? 'pgcat' : 'pgbouncer' },
            },
          });
          for (const other of services) {
            const usesIt =
              other.dependsOn.includes(s.name) || other.urls.some((u) => u.host === s.name);
            const odir = other.build
              ? posix.normalize(posix.join(posix.dirname(file), other.build))
              : undefined;
            const d =
              odir &&
              deployables.find(
                (x) => ctx.packages.find((p) => ctx.pkgSubject(p) === x.subject)?.dir === odir,
              );
            if (usesIt && d)
              out.push({
                type: 'compose-service',
                subject: `${d.subject}->${subject}`,
                data: {},
                evidence: [at(file, other.line, other.name)],
                confidence: 0.8,
                detector: 'infra.compose',
                relation: { type: 'connects-via', from: d.subject, to: subject },
              });
          }
        }
      }
    }
    // One cluster: the database lives in it.
    if (clusters.length === 1 && ctx.facts.some((f) => f.subject === DATABASE))
      out.push({
        type: 'db-database',
        subject: DATABASE,
        data: {},
        evidence: out.find((f) => f.subject === clusters[0])!.evidence,
        confidence: 0.6,
        detector: 'infra.compose',
        element: {
          kind: 'pg.database',
          name: ctx.facts.find((f) => f.subject === DATABASE)!.element!.name,
          parent: clusters[0],
        },
      });
    return out;
  },
};

const BROWSER = /^(VITE_|REACT_APP_|NEXT_PUBLIC_|PUBLIC_|EXPO_PUBLIC_)/;
const SENSITIVE = /(DATABASE|DB_|SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|TOKEN)/;

/** `infra.env`: variable names per package; browser-exposed ones flagged (RNP-004). */
const env: Detector = {
  id: 'infra.env',
  scope: 'repo',
  async run(ctx) {
    return (await ctx.engines.env()).map((v) => {
      const p = ctx.packageOf(v.file);
      return {
        type: 'env-var' as const,
        subject: `env:${v.file}:${v.name}`,
        data: {
          name: v.name,
          file: v.file,
          package: p ? ctx.pkgSubject(p) : null,
          browser: BROWSER.test(v.name),
          sensitive: SENSITIVE.test(v.name.replace(BROWSER, '')),
          ...(v.url ? { url: v.url } : {}),
        },
        evidence: [at(v.file, v.line, v.name)],
        confidence: 0.95,
        detector: 'infra.env',
      };
    });
  },
};

/** Packages that talk to a database: RNP-003 must not find them in browser code. */
export const DB_CLIENTS = [
  'pg',
  'postgres',
  '@prisma/client',
  'drizzle-orm',
  'typeorm',
  'knex',
  'kysely',
  '@neondatabase/serverless',
  'pg-promise',
  'mikro-orm',
  '@mikro-orm/core',
  'sequelize',
];
export const ORMS = [
  '@prisma/client',
  'drizzle-orm',
  'typeorm',
  'knex',
  'kysely',
  'sequelize',
  '@mikro-orm/core',
  'pg',
  'postgres',
];
const WATCHED = new Set([
  ...DB_CLIENTS,
  ...ORMS,
  'express',
  'fastify',
  '@nestjs/common',
  '@nestjs/core',
  'koa',
  'hono',
]);

/**
 * `code.imports` (repository scope): the import facts analysis rules use. Imports of
 * database clients, ORMs and web frameworks (with their file's layer), database clients
 * reachable from a React app (also through workspace libraries), imports across layers,
 * and import cycles.
 */
const imports: Detector = {
  id: 'code.imports',
  scope: 'repo',
  async run(ctx) {
    const graph = await ctx.engines.graph();
    const out: Fact[] = [];
    const layers = ctx.facts.filter((f) => f.type === 'layer-folder');
    const layerOf = (file: string) =>
      layers
        .filter((l) => file.startsWith(`${String(l.data.folder)}/`))
        .sort((a, b) => String(b.data.folder).length - String(a.data.folder).length)[0];
    const fsdSlice = (file: string, l: Fact | undefined) =>
      l?.data.style === 'fsd'
        ? file.slice(String(l.data.folder).length + 1).split('/')[0]
        : undefined;

    for (const e of graph.edges) {
      const p = ctx.packageOf(e.from);
      const pkg = p ? ctx.pkgSubject(p) : null;
      if (e.external && WATCHED.has(e.external)) {
        const l = layerOf(e.from);
        out.push({
          type: 'import',
          subject: `import:${e.from}:${e.external}`,
          data: {
            file: e.from,
            external: e.external,
            package: pkg,
            typeOnly: e.typeOnly,
            ...(l ? { layer: l.data.layer, style: l.data.style, layerSubject: l.subject } : {}),
          },
          evidence: [at(e.from, e.line, e.specifier)],
          confidence: 0.95,
          detector: 'code.imports',
        });
      }
      if (e.to && !e.typeOnly) {
        const [a, b] = [layerOf(e.from), layerOf(e.to)];
        if (a && b && a !== b && a.data.style === b.data.style)
          out.push({
            type: 'import',
            subject: `layers:${e.from}->${e.to}`,
            data: {
              file: e.from,
              to: e.to,
              style: a.data.style,
              fromLayer: a.data.layer,
              toLayer: b.data.layer,
              ...(a.data.style === 'fsd'
                ? {
                    fromRank: a.data.rank,
                    toRank: b.data.rank,
                    fromSlice: fsdSlice(e.from, a),
                    toSlice: fsdSlice(e.to, b),
                  }
                : {}),
              package: pkg,
            },
            evidence: [at(e.from, e.line, e.specifier)],
            confidence: 0.9,
            detector: 'code.imports',
          });
      }
    }

    const hasDatabase = ctx.facts.some((f) => f.subject === DATABASE);
    // RNP-003: a database client anywhere in a React app's import graph.
    for (const app of ctx.facts.filter(
      (f) => f.type === 'deployable' && f.element?.kind === 'react.app',
    )) {
      const p = ctx.packages.find((x) => ctx.pkgSubject(x) === app.subject)!;
      const base = p.dir ? `${p.dir}/` : '';
      const start = ctx.files.filter(
        (f) => f.startsWith(base) && graph.out.has(f) && !/vite\.config|\.config\./.test(f),
      );
      const seen = new Set(start);
      const via = new Map<string, string>();
      const queue = [...start];
      while (queue.length) {
        const f = queue.shift()!;
        for (const e of graph.out.get(f) ?? []) {
          if (e.typeOnly) continue;
          if (e.external && DB_CLIENTS.includes(e.external))
            out.push({
              type: 'import-violation',
              subject: `browser-db:${app.subject}:${e.from}:${e.external}`,
              data: {
                rule: 'RNP-003',
                app: app.subject,
                external: e.external,
                file: e.from,
                chain: chainOf(e.from, via),
              },
              evidence: [at(e.from, e.line, e.specifier)],
              confidence: 0.95,
              detector: 'code.imports',
              // The diagram shows what the code does: the app talks to the database.
              ...(hasDatabase
                ? {
                    relation: {
                      type: 'reads',
                      from: app.subject,
                      to: DATABASE,
                      antiPattern: `The browser bundle imports the database client "${e.external}" (${e.from}:${e.line})`,
                    },
                  }
                : {}),
            });
          if (e.to && !seen.has(e.to)) {
            seen.add(e.to);
            via.set(e.to, f);
            queue.push(e.to);
          }
        }
      }
    }

    for (const cycle of graph.cycles) {
      const evidence = cycle.flatMap((f) => {
        const e = graph.out.get(f)?.find((x) => x.to && cycle.includes(x.to) && !x.typeOnly);
        return e ? [at(f, e.line, e.specifier)] : [];
      });
      out.push({
        type: 'cycle',
        subject: `cycle:${cycle[0]}`,
        data: {
          files: cycle,
          packages: [
            ...new Set(
              cycle
                .map((f) => ctx.packageOf(f))
                .filter(Boolean)
                .map((p) => packageName(p!.name)),
            ),
          ],
        },
        evidence,
        confidence: 0.95,
        detector: 'code.imports',
      });
    }
    return out;
  },
};

function chainOf(file: string, via: Map<string, string>): string[] {
  const chain = [file];
  for (let f = via.get(file); f && chain.length < 10; f = via.get(f)) chain.unshift(f);
  return chain;
}

export const INFRA_DETECTORS: Detector[] = [compose, env, imports];
