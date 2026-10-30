import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyOps, createCatalog, newProject, slugify } from '@archguide/core';
import type { AnalysisResult, Element, Project } from '@archguide/core';
import { ANALYSIS_RULES, profile } from '@archguide/profile-react-node-postgres';
import { analyzeRepository, discover, readInside } from '.';

const catalog = createCatalog([profile]);
const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

interface Reference {
  elements: { kind: string; name?: string }[];
  relations: { type: string; from: string; to: string; inTransaction?: boolean }[];
}

const analyze = (name: string, extra: Partial<Parameters<typeof analyzeRepository>[1]> = {}) =>
  analyzeRepository(join(fixtures, name), { catalog, ...extra });

/** Share of reference elements with a candidate of the same kind (and name, when given). */
function recall(result: AnalysisResult, ref: Reference) {
  const candidates = [...result.candidates.elements];
  const missing: string[] = [];
  for (const r of ref.elements) {
    const i = candidates.findIndex(
      (c) => c.kind === r.kind && (!r.name || slugify(c.name) === slugify(r.name)),
    );
    if (i >= 0) candidates.splice(i, 1);
    else missing.push(`${r.kind} ${r.name ?? ''}`.trim());
  }
  const byName = (n: string) =>
    result.candidates.elements.filter((e) => slugify(e.name) === slugify(n)).map((e) => e.id);
  const relMissing = ref.relations.filter(
    (r) =>
      !result.candidates.relations.some(
        (c) =>
          c.type === r.type &&
          byName(r.from).includes(c.sourceId) &&
          byName(r.to).includes(c.targetId) &&
          (r.inTransaction === undefined || Boolean(c.inTransaction) === r.inTransaction),
      ),
  );
  return {
    elements: 1 - missing.length / ref.elements.length,
    relations: 1 - relMissing.length / ref.relations.length,
    missing,
    relMissing,
  };
}

describe.each([
  'vite-express-prisma',
  'nest-modular-drizzle',
  'pnpm-bff-pgboss',
  'python-fastapi-django',
  'dotnet-aspnet-efcore',
])('fixture %s', (name) => {
  it('finds at least 80% of the hand-made reference, and every item has evidence in the repository', async () => {
    const result = await analyze(name);
    const ref = JSON.parse(
      await readFile(join(fixtures, name, 'reference.json'), 'utf8'),
    ) as Reference;
    const r = recall(result, ref);
    expect(r.elements, `missing: ${r.missing.join('; ')}`).toBeGreaterThanOrEqual(0.8);
    expect(
      r.relations,
      `missing: ${r.relMissing.map((x) => `${x.from} ${x.type} ${x.to}`).join('; ')}`,
    ).toBeGreaterThanOrEqual(0.8);
    for (const item of [...result.candidates.elements, ...result.candidates.relations]) {
      expect(item.source?.origin).toBe('inferred');
      expect(item.source?.evidence?.length, `${item.id} has no evidence`).toBeGreaterThan(0);
      for (const e of item.source!.evidence!)
        expect(existsSync(join(fixtures, name, e.path)), e.path).toBe(true);
    }
    expect(result.warnings).toEqual([]);
    // The draft is a valid model: it applies to an empty project as it is.
    const project = (newProject(catalog, { name }) as { project: Project }).project;
    const applied = applyOps(
      project,
      [
        ...result.candidates.elements.map((element) => ({ op: 'addElement' as const, element })),
        ...result.candidates.relations.map((relation) => ({
          op: 'addRelation' as const,
          relation,
        })),
      ],
      catalog,
    );
    expect(applied.ok, JSON.stringify(!applied.ok && applied.errors.slice(0, 3))).toBe(true);
  });
});

describe('fixture bad-practices', () => {
  it('triggers every analysis rule, each with file and line', async () => {
    const result = await analyze('bad-practices');
    const fired = new Set(result.findings.map((f) => f.ruleId));
    for (const rule of ANALYSIS_RULES) expect(fired, rule.id).toContain(rule.id);
    for (const f of result.findings) {
      expect(f.evidence.length, f.ruleId).toBeGreaterThan(0);
      expect(
        f.evidence.some((e) => e.line),
        `${f.ruleId} has a line`,
      ).toBe(true);
    }
    expect(result.findings.find((f) => f.ruleId === 'RNP-003')?.evidence[0]).toEqual({
      path: 'apps/web/src/shared/lib/db.ts',
      line: 2,
      symbol: 'pg',
    });
  });
});

describe('analyzer pipeline', () => {
  it('parses only changed files on the second run (cache)', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'archguide-cache-'));
    const first = await analyze('vite-express-prisma', { cacheDir });
    const second = await analyze('vite-express-prisma', { cacheDir });
    expect(first.stats.cachedFiles).toBe(0);
    expect(second.stats.cachedFiles).toBeGreaterThan(5);
    expect(second.candidates).toEqual(first.candidates);
  });

  it('diffs against the model: matches by code path, suggests the rest, reports what is gone', async () => {
    const base = (newProject(catalog, { name: 'Shop' }) as { project: Project }).project;
    const elements: Element[] = [
      {
        id: 'svc.backend',
        kind: 'node.service',
        name: 'Backend',
        status: 'existing',
        codePaths: ['services/api'],
      },
      { id: 'svc.legacy', kind: 'node.service', name: 'Legacy', status: 'existing' },
    ];
    const model = (
      applyOps(
        base,
        elements.map((element) => ({ op: 'addElement', element })),
        catalog,
      ) as { project: Project }
    ).project.model;
    const result = await analyze('vite-express-prisma', { model });
    expect(result.diff!.matches['svc.api']).toBe('svc.backend');
    expect(result.diff!.missingInCode).toEqual(['svc.legacy']);
    expect(result.findings.find((f) => f.ruleId === 'DRIFT-001')?.targetIds).toEqual([
      'svc.legacy',
    ]);
    const added = result.diff!.suggestedOps.flatMap((o) =>
      o.op === 'addElement' ? [o.element] : [],
    );
    expect(added.find((e) => e.name === 'Orders routes')?.parentId).toBe('svc.backend');
  });

  it('remembers rejected subjects', async () => {
    const result = await analyze('pnpm-bff-pgboss', { rejected: new Set(['ext:Stripe']) });
    expect(result.candidates.elements.some((e) => e.name === 'Stripe')).toBe(false);
  });
});

describe('repository boundary and limits', () => {
  it('reads nothing outside the repository, also not through symbolic links', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'archguide-outside-'));
    await writeFile(join(outside, 'secret.ts'), "export const SECRET = 'outside-the-repo';");
    const repo = await mkdtemp(join(tmpdir(), 'archguide-repo-'));
    await mkdir(join(repo, 'src'));
    await writeFile(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { express: '5' } }),
    );
    await writeFile(
      join(repo, 'src', 'main.ts'),
      "import express from 'express';\nexpress().listen(3000);\n",
    );
    await symlink(join(outside, 'secret.ts'), join(repo, 'src', 'linked.ts'));
    await symlink(outside, join(repo, 'linked-dir'));
    const found = await discover(repo);
    expect(found.files).toEqual(['package.json', 'src/main.ts']);
    await expect(readInside(repo, '../secret.ts')).rejects.toThrow(/outside/);
    await expect(readInside(repo, 'src/linked.ts')).rejects.toThrow(/outside/);
    const result = await analyzeRepository(repo, { catalog });
    expect(JSON.stringify(result)).not.toContain('outside-the-repo');
    expect(result.candidates.elements.map((e) => e.kind)).toEqual(['node.service']);
  });

  it('honors .gitignore, maxFiles and the file size limit, and says the result is partial', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'archguide-limits-'));
    await writeFile(join(repo, 'package.json'), '{"name":"x"}');
    await writeFile(join(repo, '.gitignore'), 'generated/\n');
    await mkdir(join(repo, 'generated'));
    await writeFile(join(repo, 'generated', 'a.ts'), 'export {}');
    for (const n of [1, 2, 3, 4]) await writeFile(join(repo, `f${n}.ts`), 'export {}');
    await writeFile(join(repo, 'big.ts'), 'x'.repeat(2048));
    const found = await discover(repo, { maxFiles: 3, maxFileSize: 1024 });
    expect(found.files).toHaveLength(3);
    expect(found.files.some((f) => f.startsWith('generated/'))).toBe(false);
    expect(found.warnings.join(' ')).toMatch(/over 1 KB were skipped/);
    expect(found.warnings.join(' ')).toMatch(/partial/);
  });

  it('finds Python and .NET projects with their dependencies, and skips virtual environments', async () => {
    const py = await discover(join(fixtures, 'python-fastapi-django'));
    // The root pyproject.toml is tooling: the projects below it are the packages.
    expect(py.packages.map((p) => [p.dir, p.name, p.language])).toEqual([
      ['libs/common', 'shop-common', 'python'],
      ['services/catalog', 'catalog', 'python'],
      ['services/orders', 'orders', 'python'],
      ['workers/mailer', 'mailer', 'python'],
    ]);
    expect([...py.packages[2]!.deps]).toContain('shop-common');
    const net = await discover(join(fixtures, 'dotnet-aspnet-efcore'));
    const api = net.packages.find((p) => p.name === 'Orders.Api')!;
    expect(api).toMatchObject({
      language: 'dotnet',
      manifestFile: 'src/Orders.Api/Orders.Api.csproj',
    });
    expect([...api.deps]).toEqual(
      expect.arrayContaining(['MassTransit.RabbitMQ', 'Orders.Application', 'Shop.Contracts']),
    );

    const repo = await mkdtemp(join(tmpdir(), 'archguide-venv-'));
    await mkdir(join(repo, '.venv', 'lib'), { recursive: true });
    await writeFile(join(repo, '.venv', 'lib', 'requirements.txt'), 'django\n');
    await mkdir(join(repo, 'bin', 'Debug'), { recursive: true });
    await writeFile(join(repo, 'bin', 'Debug', 'x.py'), 'x = 1\n');
    await writeFile(join(repo, 'requirements.txt'), 'flask\n');
    const found = await discover(repo);
    expect(found.packages.map((p) => [p.dir, p.language])).toEqual([['', 'python']]);
    expect(found.files).toEqual(['requirements.txt']);
  });
});
