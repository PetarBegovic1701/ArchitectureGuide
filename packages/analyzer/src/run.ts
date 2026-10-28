import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  analysisContext,
  dataOwnership,
  matchModel,
  resolveFacts,
  runAnalysisRules,
} from '@archguide/core';
import type { AnalysisFinding, AnalysisResult, Catalog, Fact, Model } from '@archguide/core';
import { IndexCache } from './cache';
import { Engines, makeContext } from './context';
import type { Detector } from './context';
import { discover } from './discover';
import type { DiscoverOptions } from './discover';
import { DETECTORS } from './detectors';

export interface AnalyzeOptions extends DiscoverOptions {
  catalog: Catalog;
  /** The current model, to compute the diff. */
  model?: Model;
  /** Subjects the user rejected before (`.archguide/analysis/rejected.json`). */
  rejected?: ReadonlySet<string>;
  /** Folder for the index cache (`.archguide/analysis/cache`). */
  cacheDir?: string;
  /** Default 120 s. When it is hit, the result is partial and says so. */
  timeoutMs?: number;
  detectors?: Detector[];
  /** Extra facts (live database introspection). */
  extraFacts?: Fact[];
}

/**
 * Runs the analyzer on a repository (Implementation.md §19.2): discover → engines →
 * detectors → data ownership → resolve → analysis rules → match. Reads files only; runs
 * no code of the repository.
 */
export async function analyzeRepository(
  repoRoot: string,
  options: AnalyzeOptions,
): Promise<AnalysisResult> {
  const started = Date.now();
  const repo = await discover(repoRoot, options);
  const cache = await IndexCache.open(options.cacheDir);
  const engines = new Engines(repo, cache);
  const facts: Fact[] = [...(options.extraFacts ?? [])];
  const timeout = options.timeoutMs ?? 120_000;
  const warnings = [...repo.warnings];
  const fallback = repo.packages[0] ?? {
    name: 'root',
    dir: '',
    manifest: { dependencies: {}, devDependencies: {}, scripts: {} },
    deps: new Set<string>(),
  };

  outer: for (const detector of options.detectors ?? DETECTORS) {
    const runs =
      detector.scope === 'repo'
        ? [makeContext(engines, fallback, repo.files, facts)]
        : repo.packages
            .filter((p) => detector.appliesTo?.(p) ?? true)
            .map((p) =>
              makeContext(
                engines,
                p,
                repo.files.filter((f) => p.dir === '' || f.startsWith(`${p.dir}/`)),
                facts,
              ),
            );
    for (const ctx of runs) {
      if (Date.now() - started > timeout) {
        warnings.push(
          `The analysis stopped after ${Math.round(timeout / 1000)} s (timeout); the result is partial.`,
        );
        break outer;
      }
      try {
        facts.push(...(await detector.run(ctx)));
      } catch (error) {
        warnings.push(
          `Detector ${detector.id} failed on ${ctx.pkg.dir || 'the root'}: ${(error as Error).message}`,
        );
      }
    }
  }
  await cache.save();

  const { ownership, facts: owned } = dataOwnership(facts);
  const all = [...facts, ...owned];
  const resolved = resolveFacts(
    all,
    options.catalog,
    options.rejected ? { rejected: options.rejected } : {},
  );
  // §19.5: a schema with exactly one migration owner is owned by it.
  for (const [schema, s] of Object.entries(ownership.schemas)) {
    const id = resolved.subjects[schema];
    const owner = s.owners.length === 1 ? resolved.subjects[s.owners[0]!.deployable] : undefined;
    const el = resolved.candidates.elements.find((e) => e.id === id);
    if (el && owner) el.properties = { ...el.properties, ownedBy: owner };
  }

  const ctx = analysisContext(
    all,
    resolved.candidates,
    resolved.subjects,
    ownership,
    options.catalog,
  );
  const rules = options.catalog.profiles.flatMap((p) => p.analysisRules ?? []);
  const findings: AnalysisFinding[] = runAnalysisRules(rules, ctx);

  const result: AnalysisResult = {
    repoRoot: repo.root,
    analyzedAt: new Date().toISOString(),
    durationMs: 0,
    stats: {
      files: repo.files.length,
      packages: repo.packages.length,
      facts: all.length,
      cachedFiles: cache.hits,
    },
    facts: all,
    candidates: resolved.candidates,
    subjects: resolved.subjects,
    findings,
    warnings: [...warnings, ...engines.warnings, ...resolved.warnings],
  };
  if (options.model) {
    result.diff = matchModel(options.model, resolved.candidates, {
      detectableKinds: new Set(resolved.candidates.elements.map((e) => e.kind)),
    });
    for (const id of result.diff.missingInCode) {
      const el = options.model.elements.find((e) => e.id === id)!;
      findings.push({
        ruleId: 'DRIFT-001',
        title: 'Element not found in code',
        severity: 'warning',
        message: `${el.name} is in the model as existing, but the analyzer did not find it in the code. Update its code paths, mark it planned or deprecated, or remove it.`,
        targetIds: [id],
        relatedIds: [],
        fixes: [
          {
            title: 'Mark it as planned',
            ops: [{ op: 'updateElement', id, patch: { status: 'planned' } }],
          },
        ],
        evidence: [],
      });
    }
  }
  result.durationMs = Date.now() - started;
  return result;
}

/** `.archguide/analysis/` of a workspace folder. */
export const analysisDir = (workspaceDir: string) => join(workspaceDir, '.archguide', 'analysis');

/** Writes the result to `.archguide/analysis/last.json` (gitignored). */
export async function writeAnalysis(workspaceDir: string, result: AnalysisResult): Promise<string> {
  const dir = analysisDir(workspaceDir);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'last.json');
  await writeFile(`${path}.tmp`, JSON.stringify(result, null, 2));
  await rename(`${path}.tmp`, path);
  return path;
}

export async function readAnalysis(workspaceDir: string): Promise<AnalysisResult | undefined> {
  try {
    return JSON.parse(
      await readFile(join(analysisDir(workspaceDir), 'last.json'), 'utf8'),
    ) as AnalysisResult;
  } catch {
    return undefined;
  }
}

/** Subjects the user rejected in the review panel (`rejected.json`). */
export async function readRejected(workspaceDir: string): Promise<Set<string>> {
  try {
    const list = JSON.parse(
      await readFile(join(analysisDir(workspaceDir), 'rejected.json'), 'utf8'),
    ) as unknown;
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch {
    return new Set();
  }
}
