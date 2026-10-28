import type {
  Element,
  EnforcementGenerator,
  GeneratedConfig,
  GeneratorContext,
  Id,
  Project,
} from '@archguide/core';

/**
 * Enforcement generators (Implementation.md §23.1). The model is turned into boundaries —
 * "code under this path must not import that" — and each generator renders them for one
 * tool. Sources: the profile defaults (no database client in React apps, a domain free of
 * ORMs and frameworks, Feature-Sliced Design direction and feature isolation, no cycles)
 * and, in strict packs, every import between sibling parts that the model does not show.
 */

export const DB_CLIENTS = [
  'pg',
  'postgres',
  '@prisma/client',
  'drizzle-orm',
  'typeorm',
  'knex',
  'kysely',
  '@neondatabase/serverless',
  'sequelize',
];
const INFRA_PACKAGES = [
  ...DB_CLIENTS,
  'express',
  'fastify',
  '@nestjs/common',
  '@nestjs/core',
  'koa',
  'hono',
  'pg-boss',
  'graphile-worker',
];
const FSD_LAYERS = ['app', 'pages', 'widgets', 'features', 'entities', 'shared'];
const STRICT_PACKS = ['layered', 'hexagonal', 'modular-monolith', 'fsd'];
const SIBLING_KINDS = new Set([
  'node.module',
  'node.domain',
  'node.use-case',
  'node.port',
  'node.repository',
  'node.route-handler',
]);

export interface Boundary {
  name: string;
  comment: string;
  severity: 'error' | 'warn';
  /** Path prefixes (repository-relative) the rule applies to. */
  from: string[];
  /** Path prefixes that must not be imported. */
  toPaths?: string[];
  /** npm packages that must not be imported. */
  toPackages?: string[];
  /** Feature isolation: `from` is the features folder; one slice must not import another. */
  slices?: boolean;
}

const clean = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slug = (id: Id) => id.replace(/[^a-z0-9]+/gi, '-');
const prefixRe = (paths: readonly string[]) =>
  `^(${paths.map((p) => escape(clean(p))).join('|')})(/|$)`;
const packageRe = (packages: readonly string[]) =>
  `(^|node_modules/)(${packages.map(escape).join('|')})(/|$)`;

function descendants(p: Project, id: Id): Set<Id> {
  const out = new Set<Id>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of p.model.elements)
      if (e.parentId && out.has(e.parentId) && !out.has(e.id)) {
        out.add(e.id);
        grew = true;
      }
  }
  return out;
}

/** The boundaries the model implies, in a stable order. */
export function boundaries(project: Project): Boundary[] {
  const els = project.model.elements;
  const packs = new Set(project.settings.rulePacks);
  const out: Boundary[] = [];
  const paths = (e: Element) => (e.codePaths ?? []).map(clean).filter((x) => x && x !== '.');

  for (const app of els.filter((e) => e.kind === 'react.app' && paths(e).length)) {
    out.push({
      name: `AG-RNP-003-no-db-client-in-${slug(app.id)}`,
      comment: `Browser code MUST NOT import database clients (${app.id}).`,
      severity: 'error',
      from: paths(app),
      toPackages: DB_CLIENTS,
    });
    const fsd =
      packs.has('fsd') ||
      els.some(
        (e) => e.parentId === app.id && e.kind === 'react.feature' && e.properties?.fsdLayer,
      );
    if (!fsd) continue;
    const src = paths(app).map((p) => `${p}/src`);
    FSD_LAYERS.forEach((layer, i) => {
      const higher = FSD_LAYERS.slice(0, i);
      if (!higher.length) return;
      out.push({
        name: `AG-RNP-013-fsd-${layer}-${slug(app.id)}`,
        comment: `Feature-Sliced Design: ${layer} MUST NOT import ${higher.join(', ')} (${app.id}).`,
        severity: 'warn',
        from: src.map((s) => `${s}/${layer}`),
        toPaths: src.flatMap((s) => higher.map((h) => `${s}/${h}`)),
      });
    });
    out.push({
      name: `AG-RNP-014-feature-isolation-${slug(app.id)}`,
      comment: `A feature MUST NOT import another feature (${app.id}).`,
      severity: 'warn',
      from: src.map((s) => `${s}/features`),
      slices: true,
    });
  }

  for (const dom of els.filter((e) => e.kind === 'node.domain' && paths(e).length)) {
    const siblings = els.filter(
      (e) =>
        e.parentId === dom.parentId &&
        e.id !== dom.id &&
        ['node.repository', 'node.route-handler'].includes(e.kind) &&
        paths(e).length,
    );
    out.push({
      name: `AG-RNP-006-domain-no-infra-${slug(dom.id)}`,
      comment: `${dom.id} MUST NOT depend on adapters, ORMs or web frameworks${dom.parentId ? ` (${dom.parentId})` : ''}.`,
      severity: packs.has('hexagonal') ? 'error' : 'warn',
      from: paths(dom),
      toPackages: INFRA_PACKAGES,
      ...(siblings.length ? { toPaths: siblings.flatMap(paths) } : {}),
    });
  }

  // Strict packs: an import between sibling parts the model does not connect is forbidden.
  if (STRICT_PACKS.some((p) => packs.has(p))) {
    const connected = (a: Element, b: Element) => {
      const [from, to] = [descendants(project, a.id), descendants(project, b.id)];
      return project.model.relations.some((r) => from.has(r.sourceId) && to.has(r.targetId));
    };
    const parts = els.filter((e) => SIBLING_KINDS.has(e.kind) && paths(e).length);
    for (const a of parts)
      for (const b of parts) {
        if (a === b || a.parentId !== b.parentId || connected(a, b)) continue;
        if (
          paths(a).some((x) =>
            paths(b).some((y) => x.startsWith(`${y}/`) || y.startsWith(`${x}/`) || x === y),
          )
        )
          continue;
        // Inside a deployable, handlers may call use cases and so on only along modeled relations.
        out.push({
          name: `AG-${slug(a.id)}-not-${slug(b.id)}`,
          comment: `${a.id} MUST NOT import ${b.id}: the model has no relation between them.`,
          severity: 'error',
          from: paths(a),
          toPaths: paths(b),
        });
      }
  }
  return out;
}

const header = (project: Project, ctx: GeneratorContext, tool: string, regenerate: string) => [
  `Generated by archguide from ${ctx.projectPath} (revision ${project.revision}). Do not edit.`,
  `Regenerate: npx archguide generate ${regenerate}`,
  `Paths are relative to the repository root; run ${tool} from there.`,
];

/** dependency-cruiser (the default): works in CI without ArchitectureGuide installed (§23.2). */
export const dependencyCruiser: EnforcementGenerator = {
  id: 'dependency-cruiser',
  name: 'dependency-cruiser',
  generate(project, ctx): GeneratedConfig {
    const forbidden: Record<string, unknown>[] = boundaries(project).map((b) => {
      const group = `(${b.from.map((f) => escape(clean(f))).join('|')})`;
      return {
        name: b.name,
        comment: b.comment,
        severity: b.severity,
        from: { path: b.slices ? `^${group}/([^/]+)/` : prefixRe(b.from) },
        to: b.slices
          ? // $2 is the slice the import comes from (dependency-cruiser group matching).
            { path: `^${group}/`, pathNot: `^${group}/$2/` }
          : {
              path: [
                b.toPaths?.length ? prefixRe(b.toPaths) : undefined,
                b.toPackages?.length ? packageRe(b.toPackages) : undefined,
              ]
                .filter(Boolean)
                .join('|'),
            },
      };
    });
    forbidden.push({
      name: 'AG-no-circular',
      comment: 'No import cycles (AP-003, RNP-018).',
      severity: 'warn',
      from: {},
      to: { circular: true },
    });
    const config = {
      forbidden,
      options: {
        doNotFollow: { path: 'node_modules' },
        tsPreCompilationDeps: true,
        combinedDependencies: true,
      },
    };
    const content = [
      ...header(project, ctx, 'npx depcruise --config <this file> .', 'dependency-cruiser').map(
        (l) => `// ${l}`,
      ),
      "/** @type {import('dependency-cruiser').IConfiguration} */",
      `module.exports = ${JSON.stringify(config, null, 2)};`,
      '',
    ].join('\n');
    return {
      path: '.archguide/dependency-cruiser.cjs',
      content,
      rules: forbidden.map((r) => String(r.name)),
      data: config,
    };
  },
};

/** Nx module boundaries: project tags and `@nx/enforce-module-boundaries` constraints. */
export const nx: EnforcementGenerator = {
  id: 'nx',
  name: 'Nx module boundaries',
  generate(project, ctx): GeneratedConfig {
    const projects = project.model.elements.filter(
      (e) =>
        [
          'react.app',
          'node.service',
          'node.bff',
          'node.worker',
          'node.shared-lib',
          'node.contract',
          'react.design-system',
        ].includes(e.kind) && e.codePaths?.length,
    );
    const tag = (e: Element) => `scope:${e.id}`;
    const isApp = (e: Element) =>
      ['react.app', 'node.service', 'node.bff', 'node.worker'].includes(e.kind);
    const depConstraints = projects.map((e) => {
      const allowed = projects.filter(
        (o) =>
          o !== e &&
          !isApp(o) &&
          project.model.relations.some((r) => r.sourceId === e.id && r.targetId === o.id),
      );
      return {
        sourceTag: tag(e),
        onlyDependOnLibsWithTags: allowed.map(tag),
        ...(e.kind === 'react.app' ? { bannedExternalImports: DB_CLIENTS } : {}),
      };
    });
    const content = `${JSON.stringify(
      {
        $comment: [
          ...header(project, ctx, 'Nx', 'nx'),
          'Add each project\'s "tags" to its project.json, and the depConstraints to the @nx/enforce-module-boundaries ESLint rule.',
        ],
        projects: Object.fromEntries(
          projects.map((e) => [
            clean(e.codePaths![0]!),
            { tags: [tag(e), `type:${isApp(e) ? 'app' : 'lib'}`] },
          ]),
        ),
        depConstraints,
      },
      null,
      2,
    )}\n`;
    return {
      path: '.archguide/nx-boundaries.json',
      content,
      rules: depConstraints.map((d) => d.sourceTag),
    };
  },
};

/** ArchUnitTS tests (`archunit` on npm) for the folder boundaries, run by Vitest or Jest. */
export const archunit: EnforcementGenerator = {
  id: 'archunit',
  name: 'ArchUnitTS',
  generate(project, ctx): GeneratedConfig {
    const folder = boundaries(project).filter((b) => b.toPaths?.length && !b.slices);
    const lines = [
      ...header(project, ctx, 'your test runner', 'archunit').map((l) => `// ${l}`),
      '// npm packages (database clients, ORMs) are checked by the dependency-cruiser config.',
      "import { describe, expect, it } from 'vitest';",
      "import { projectFiles } from 'archunit';",
      '',
      `describe('architecture of ${project.name.replace(/'/g, "\\'")}', () => {`,
    ];
    for (const b of folder)
      for (const from of b.from)
        for (const to of b.toPaths!) {
          lines.push(
            `  it(${JSON.stringify(`${b.name}: ${from} must not import ${to}`)}, async () => {`,
            `    const rule = projectFiles().inFolder(${JSON.stringify(`${from}/**`)}).shouldNot().dependOnFiles().inFolder(${JSON.stringify(`${to}/**`)});`,
            '    await expect(rule).toPassAsync();',
            '  });',
          );
        }
    const apps = project.model.elements.filter(
      (e) => ['node.service', 'node.bff', 'node.worker'].includes(e.kind) && e.codePaths?.length,
    );
    for (const a of apps)
      lines.push(
        `  it(${JSON.stringify(`AG-no-circular: ${a.codePaths![0]} has no cycles`)}, async () => {`,
        `    await expect(projectFiles().inFolder(${JSON.stringify(`${clean(a.codePaths![0]!)}/**`)}).should().haveNoCycles()).toPassAsync();`,
        '  });',
      );
    lines.push('});', '');
    return {
      path: '.archguide/architecture.archunit.spec.ts',
      content: lines.join('\n'),
      rules: folder.map((b) => b.name),
    };
  },
};

export const GENERATORS: EnforcementGenerator[] = [dependencyCruiser, nx, archunit];
