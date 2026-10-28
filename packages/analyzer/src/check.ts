import { cruise } from 'dependency-cruiser';
import { findingKey, runRules, suppressionKey } from '@archguide/core';
import type { AnalysisResult, Finding, Id, Project, Severity } from '@archguide/core';
import { analyzeRepository } from './run';
import type { AnalyzeOptions } from './run';
import { readInside } from './discover';
import { indexSource } from './engines/ts-index';
import { packageName } from './engines/graph';

export type CheckSource = 'model' | 'analysis' | 'dependency-cruiser' | 'drift';

export interface CheckItem {
  source: CheckSource;
  ruleId: string;
  severity: Severity;
  message: string;
  file?: string;
  line?: number;
  targetIds: Id[];
}

export interface CheckReport {
  items: CheckItem[];
  counts: Record<Severity, number>;
  /** True when an item is at or above `failOn`. */
  failed: boolean;
  analysis: AnalysisResult;
  /** dependency-cruiser could not run (for example a syntax error it cannot parse). */
  errors: string[];
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export interface CheckOptions extends Omit<AnalyzeOptions, 'model'> {
  project: Project;
  /** For the generated config's header: the project file, relative to the repository. */
  projectPath: string;
  failOn?: Severity;
  /** Skip the dependency-cruiser step (tests, or repos it cannot parse). */
  skipDependencyCruiser?: boolean;
}

/** The line of the import that brings `to` into `file`, for annotations. */
async function importLine(
  root: string,
  file: string,
  to: string,
  unresolved?: string,
): Promise<number | undefined> {
  try {
    const index = indexSource(file, await readInside(root, file));
    const target = unresolved ?? to;
    const hit =
      index.imports.find((i) => i.specifier === target) ??
      index.imports.find(
        (i) =>
          !i.specifier.startsWith('.') &&
          (to.includes(`node_modules/${packageName(i.specifier)}/`) ||
            packageName(i.specifier) === packageName(target)),
      ) ??
      index.imports.find(
        (i) =>
          i.specifier.startsWith('.') &&
          to
            .replace(/\.[cm]?[jt]sx?$/, '')
            .endsWith(i.specifier.replace(/^(\.\.?\/)+/, '').replace(/\.[cm]?[jt]sx?$/, '')),
      );
    return hit?.line;
  } catch {
    return undefined;
  }
}

/**
 * `archguide check` (Implementation.md §23.3): model rules, the analyzer and its rules,
 * dependency-cruiser with the generated rules (in memory; the file need not exist), and
 * drift. Suppressed findings are left out. The report fails at `failOn` (default error).
 */
export async function checkRepository(
  repoRoot: string,
  options: CheckOptions,
): Promise<CheckReport> {
  const { project, catalog } = options;
  const failOn = options.failOn ?? 'error';
  const items: CheckItem[] = [];
  const errors: string[] = [];

  for (const f of runRules(project, catalog).filter((x) => !x.suppressed))
    items.push({
      source: 'model',
      ruleId: f.ruleId,
      severity: f.severity,
      message: f.message,
      targetIds: f.targetIds,
    });

  const analysis = await analyzeRepository(repoRoot, { ...options, model: project.model });
  const matches = analysis.diff?.matches ?? {};
  const suppressed = new Set(project.settings.suppressions.map((s) => suppressionKey(s)));
  const toModel = (f: Finding) => ({ ...f, targetIds: f.targetIds.map((id) => matches[id] ?? id) });
  for (const raw of analysis.findings) {
    const f = toModel(raw);
    if (suppressed.has(findingKey(f))) continue;
    const at = raw.evidence.find((e) => e.line) ?? raw.evidence[0];
    items.push({
      source: f.ruleId === 'DRIFT-001' ? 'drift' : 'analysis',
      ruleId: f.ruleId,
      severity: f.severity,
      message: f.message,
      ...(at ? { file: at.path, ...(at.line ? { line: at.line } : {}) } : {}),
      targetIds: f.targetIds,
    });
  }
  // New deployables in the code that the model does not show yet.
  for (const id of analysis.diff?.newInCode ?? []) {
    const op = analysis.diff!.suggestedOps.find(
      (o) => o.op === 'addElement' && o.element.id === id,
    );
    const el = op?.op === 'addElement' ? op.element : undefined;
    if (!el || !['react.app', 'node.service', 'node.bff', 'node.worker'].includes(el.kind))
      continue;
    const at = el.source?.evidence?.[0];
    items.push({
      source: 'drift',
      ruleId: 'DRIFT-002',
      severity: 'info',
      message: `${el.name} (${el.kind}) is in the code but not in the model. Run "archguide analyze --write" or add it.`,
      ...(at ? { file: at.path, ...(at.line ? { line: at.line } : {}) } : {}),
      targetIds: [id],
    });
  }

  const generator = catalog.profiles
    .flatMap((p) => p.generators ?? [])
    .find((g) => g.id === 'dependency-cruiser');
  if (generator && !options.skipDependencyCruiser) {
    const config = generator.generate(project, { catalog, projectPath: options.projectPath })
      .data as {
      forbidden: { name: string; comment?: string }[];
      options: Record<string, unknown>;
    };
    try {
      const out = await cruise(['.'], {
        baseDir: analysis.repoRoot,
        validate: true,
        ruleSet: { forbidden: config.forbidden } as never,
        ...config.options,
        exclude: { path: '(^|/)(node_modules|dist|build|coverage|\\.archguide|\\.git)/' },
      } as never);
      const result = out.output as {
        summary: {
          violations: {
            from: string;
            to: string;
            unresolvedTo?: string;
            type?: string;
            rule: { name: string; severity: string };
          }[];
        };
      };
      for (const v of result.summary.violations) {
        const rule = config.forbidden.find((r) => r.name === v.rule.name);
        const severity: Severity =
          v.rule.severity === 'error' ? 'error' : v.rule.severity === 'warn' ? 'warning' : 'info';
        const line = await importLine(analysis.repoRoot, v.from, v.to, v.unresolvedTo);
        items.push({
          source: 'dependency-cruiser',
          ruleId: v.rule.name,
          severity,
          message:
            `${v.from} imports ${v.unresolvedTo ?? v.to}${v.type === 'cycle' ? ' (import cycle)' : ''}. ${rule?.comment ?? ''}`.trim(),
          file: v.from,
          ...(line ? { line } : {}),
          targetIds: [],
        });
      }
    } catch (error) {
      errors.push(`dependency-cruiser: ${(error as Error).message}`);
    }
  }

  // A rule that is both a model and an analysis rule: keep the analysis finding (it has a file and line).
  const fromCode = new Set(items.filter((i) => i.source === 'analysis').map((i) => findingKey(i)));
  for (let n = items.length - 1; n >= 0; n--)
    if (items[n]!.source === 'model' && fromCode.has(findingKey(items[n]!))) items.splice(n, 1);

  items.sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      (a.file ?? '').localeCompare(b.file ?? ''),
  );
  const counts = { error: 0, warning: 0, info: 0 } as Record<Severity, number>;
  for (const i of items) counts[i.severity]++;
  return {
    items,
    counts,
    failed: items.some((i) => RANK[i.severity] <= RANK[failOn]) || errors.length > 0,
    analysis,
    errors,
  };
}

/** GitHub Actions workflow commands (`::error file=…,line=…::message`). */
export function githubAnnotations(report: CheckReport): string {
  const level = { error: 'error', warning: 'warning', info: 'notice' } as const;
  const esc = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const prop = (s: string) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
  return report.items
    .map((i) => {
      const props = [
        i.file ? `file=${prop(i.file)}` : undefined,
        i.line ? `line=${i.line}` : undefined,
        `title=${prop(i.ruleId)}`,
      ]
        .filter(Boolean)
        .join(',');
      return `::${level[i.severity]} ${props}::${esc(i.message)}`;
    })
    .join('\n');
}
