import { relative, resolve } from 'node:path';
import type { Command } from 'commander';
import { Option } from 'commander';
import type pc from 'picocolors';
import { ENFORCEMENT_TARGETS, applyOps, layOutChangeOps, selectSuggestions } from '@archguide/core';
import type { AnalysisResult, Catalog, Project, Severity } from '@archguide/core';
import {
  analysisDir,
  analyzeRepository,
  checkRepository,
  githubAnnotations,
  introspectDatabase,
  readRejected,
  writeAnalysis,
} from '@archguide/analyzer';
import type { Workspace } from '@archguide/workspace';
import { PROJECT_SUFFIX, applyToWorkspace, writeFileAtomic } from '@archguide/workspace';
import { CliError, EXIT } from './io';
import type { Io } from './io';

export interface CommandEnv {
  io: Io;
  catalog: Catalog;
  paint: ReturnType<typeof pc.createColors>;
  workspace(): Workspace;
  project(ws: Workspace): Promise<Project>;
  info(text: string): void;
  json(value: unknown): void;
  global(): { json?: boolean; quiet?: boolean };
  setExit(code: number): void;
  shortPath(path: string): string;
}

const collect = (value: string, previous: string[] = []) => [...previous, value];

/** The code the model describes: `[path]`, else the workspace's codeRoot (default ".."). */
async function codeRoot(env: CommandEnv, ws: Workspace, path?: string) {
  if (path) return resolve(env.io.cwd, path);
  const config = (await ws.exists()) ? await ws.readConfig() : {};
  return resolve(ws.dir, config.codeRoot ?? '..');
}

function summary(r: AnalysisResult): Record<string, number> {
  const byKind: Record<string, number> = {};
  for (const e of r.candidates.elements) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  return Object.fromEntries(Object.entries(byKind).sort(([a], [b]) => a.localeCompare(b)));
}

/** Facts of the live database when `--db` is on (Implementation.md §19.7); the URL only from the environment. */
async function databaseFacts(env: CommandEnv, ws: Workspace, db: boolean | undefined) {
  const config = (await ws.exists()) ? await ws.readConfig() : {};
  const urlEnv = (config.analyzer as { database?: { urlEnv?: string } } | undefined)?.database
    ?.urlEnv;
  if (!db && !urlEnv) return [];
  const name = urlEnv ?? 'ARCHGUIDE_DATABASE_URL_READONLY';
  const url = process.env[name];
  if (!url) {
    if (db) throw new CliError(`--db needs the database URL in the environment variable ${name}.`);
    return [];
  }
  env.info(env.paint.dim(`Reading the database catalog (read-only) from $${name} …`));
  return introspectDatabase({ url });
}

export function registerAnalysisCommands(program: Command, env: CommandEnv): void {
  const { paint } = env;

  program
    .command('analyze')
    .description('read the repository and draft the model with evidence (no code is run)')
    .argument('[path]', 'repository folder (default: the workspace code root)')
    .option(
      '--write',
      'add the suggested elements and relations to the project (as inferred, not reviewed)',
    )
    .option('--min-confidence <n>', 'with --write: skip less certain items', (v) => Number(v), 0.6)
    .option(
      '--db',
      'also read the live database catalog (URL from ARCHGUIDE_DATABASE_URL_READONLY)',
    )
    .option('--include <glob>', 'only these files (repeatable)', collect)
    .option('--exclude <glob>', 'skip these files (repeatable)', collect)
    .action(
      async (
        path: string | undefined,
        o: {
          write?: boolean;
          minConfidence: number;
          db?: boolean;
          include?: string[];
          exclude?: string[];
        },
      ) => {
        const ws = env.workspace();
        const hasWorkspace = await ws.exists();
        if (o.write && !hasWorkspace)
          throw new CliError(`No workspace at ${ws.dir}. Run "archguide init" first.`);
        const project =
          hasWorkspace && (await ws.listProjects()).length ? await env.project(ws) : undefined;
        const root = await codeRoot(env, ws, path);
        const result = await analyzeRepository(root, {
          catalog: env.catalog,
          ...(project ? { model: project.model } : {}),
          ...(o.include ? { include: o.include } : {}),
          ...(o.exclude ? { exclude: o.exclude } : {}),
          ...(hasWorkspace
            ? {
                rejected: await readRejected(ws.dir),
                cacheDir: resolve(analysisDir(ws.dir), 'cache'),
              }
            : {}),
          extraFacts: await databaseFacts(env, ws, o.db),
        });
        const saved = hasWorkspace ? await writeAnalysis(ws.dir, result) : undefined;
        let applied = 0;
        if (o.write && project && result.diff) {
          const ops = selectSuggestions(result.diff, { minConfidence: o.minConfidence });
          if (ops.length) {
            const trial = applyOps(project, ops, env.catalog);
            const placed = trial.ok ? layOutChangeOps(project, trial.project, env.catalog) : [];
            const r = await applyToWorkspace(ws, env.catalog, project.id, [...ops, ...placed], {
              origin: 'cli',
            });
            if (!r.ok)
              throw new CliError(
                `The suggestions did not apply: ${r.errors.map((e) => e.message).join('; ')}`,
              );
            applied = ops.length;
          }
        }
        if (env.global().json)
          return env.json({
            stats: result.stats,
            durationMs: result.durationMs,
            candidates: summary(result),
            findings: result.findings,
            diff: result.diff
              ? {
                  newInCode: result.diff.newInCode,
                  missingInCode: result.diff.missingInCode,
                  changed: result.diff.changed,
                  suggestedOps: result.diff.suggestedOps.length,
                }
              : undefined,
            applied,
            warnings: result.warnings,
            ...(saved ? { saved } : {}),
          });
        env.io.out(
          `Analyzed ${result.stats.files} files in ${result.stats.packages} package(s) in ${(result.durationMs / 1000).toFixed(1)} s (${result.stats.cachedFiles} from cache).\n`,
        );
        for (const [kind, n] of Object.entries(summary(result)))
          env.io.out(`  ${String(n).padStart(3)} ${kind}\n`);
        env.io.out(
          `  ${result.candidates.relations.length} relations, ${result.findings.length} finding(s)\n`,
        );
        if (result.diff)
          env.io.out(
            `Compared with ${project!.name}: ${result.diff.newInCode.length} new in code, ${result.diff.missingInCode.length} missing in code, ${result.diff.changed.length} changed.\n`,
          );
        for (const f of result.findings.slice(0, 20)) {
          const at = f.evidence.find((e) => e.line) ?? f.evidence[0];
          env.io.out(
            `${paint.yellow(f.ruleId)} ${f.message}${at ? paint.dim(` (${at.path}${at.line ? `:${at.line}` : ''})`) : ''}\n`,
          );
        }
        // What the code does against the rules: in the draft as found, marked (AP-019).
        for (const x of [...result.candidates.elements, ...result.candidates.relations].filter(
          (i) => i.antiPattern,
        ))
          env.io.out(
            `${paint.yellow('anti-pattern')} ${x.antiPattern!.note}${x.antiPattern!.violates ? paint.dim(` (${x.antiPattern!.violates})`) : ''}\n`,
          );
        for (const w of result.warnings) env.io.out(`${paint.yellow('warning')} ${w}\n`);
        if (o.write)
          env.info(
            `${paint.green('✓')} added ${applied} item(s) to ${project!.name} (inferred, not reviewed yet)`,
          );
        else if (result.diff?.suggestedOps.length)
          env.info(
            paint.dim(
              'Review the suggestions in the editor (Analysis panel), or run "archguide analyze --write".',
            ),
          );
        if (saved) env.info(paint.dim(`Saved ${env.shortPath(saved)}`));
      },
    );

  program
    .command('check')
    .description('CI gate: model rules, analysis rules, generated dependency rules and drift')
    .addOption(
      new Option('--fail-on <severity>', 'exit with code 1 at this severity or above')
        .choices(['error', 'warning', 'info'])
        .default('error'),
    )
    .addOption(
      new Option('--format <format>', 'output format')
        .choices(['text', 'json', 'github'])
        .default('text'),
    )
    .argument('[path]', 'repository folder (default: the workspace code root)')
    .action(
      async (
        path: string | undefined,
        o: { failOn: Severity; format: 'text' | 'json' | 'github' },
      ) => {
        const ws = env.workspace();
        const project = await env.project(ws);
        const root = await codeRoot(env, ws, path);
        const report = await checkRepository(root, {
          catalog: env.catalog,
          project,
          projectPath:
            relative(root, ws.fileFor(project.id)).split('\\').join('/') ||
            `${project.id}${PROJECT_SUFFIX}`,
          failOn: o.failOn,
          rejected: await readRejected(ws.dir),
          cacheDir: resolve(analysisDir(ws.dir), 'cache'),
        });
        await writeAnalysis(ws.dir, report.analysis);
        if (o.format === 'json' || env.global().json)
          env.json({
            failed: report.failed,
            counts: report.counts,
            items: report.items,
            errors: report.errors,
          });
        else if (o.format === 'github') {
          const text = githubAnnotations(report);
          if (text) env.io.out(`${text}\n`);
          for (const e of report.errors) env.io.out(`::error title=archguide::${e}\n`);
        } else {
          const tag = {
            error: paint.red('error  '),
            warning: paint.yellow('warning'),
            info: paint.blue('info   '),
          };
          for (const i of report.items)
            env.io.out(
              `${tag[i.severity]} ${paint.bold(i.ruleId)} ${i.message}${i.file ? paint.dim(` ${i.file}${i.line ? `:${i.line}` : ''}`) : ''}\n`,
            );
          for (const e of report.errors) env.io.out(`${tag.error} ${e}\n`);
          env.info(
            `${report.items.length ? '\n' : ''}${project.name}: ${report.counts.error} error(s), ${report.counts.warning} warning(s), ${report.counts.info} tip(s) — ${report.failed ? paint.red(`failed (--fail-on ${o.failOn})`) : paint.green('passed')}`,
          );
        }
        if (report.failed) env.setExit(EXIT.findings);
      },
    );

  program
    .command('drift')
    .description('differences between the model and the code')
    .addOption(
      new Option('--format <format>', 'output format').choices(['text', 'json']).default('text'),
    )
    .argument('[path]', 'repository folder (default: the workspace code root)')
    .action(async (path: string | undefined, o: { format: 'text' | 'json' }) => {
      const ws = env.workspace();
      const project = await env.project(ws);
      const result = await analyzeRepository(await codeRoot(env, ws, path), {
        catalog: env.catalog,
        model: project.model,
        rejected: await readRejected(ws.dir),
        cacheDir: resolve(analysisDir(ws.dir), 'cache'),
      });
      await writeAnalysis(ws.dir, result);
      const diff = result.diff!;
      const name = (id: string) =>
        project.model.elements.find((e) => e.id === id)?.name ??
        diff.suggestedOps.flatMap((x) =>
          x.op === 'addElement' && x.element.id === id ? [x.element.name] : [],
        )[0] ??
        id;
      if (o.format === 'json' || env.global().json)
        return env.json({
          newInCode: diff.newInCode,
          missingInCode: diff.missingInCode,
          changed: diff.changed,
          suggestedOps: diff.suggestedOps,
        });
      const section = (title: string, ids: string[], mark: string) => {
        env.io.out(`${paint.bold(title)} (${ids.length})\n`);
        for (const id of ids) env.io.out(`  ${mark} ${name(id)} ${paint.dim(id)}\n`);
      };
      section('In the code, not in the model', diff.newInCode, paint.green('+'));
      section(
        'In the model as existing, not found in the code',
        diff.missingInCode,
        paint.red('-'),
      );
      env.io.out(`${paint.bold('Changed')} (${diff.changed.length})\n`);
      for (const c of diff.changed)
        env.io.out(`  ${paint.yellow('~')} ${name(c.id)} ${paint.dim(c.fields.join(', '))}\n`);
    });

  program
    .command('generate')
    .description(`enforcement configs from the model: ${ENFORCEMENT_TARGETS.join(', ')}`)
    .argument('<target>', ENFORCEMENT_TARGETS.join(' | '))
    .option('--out <path>', 'where to write (relative to the workspace folder)')
    .option('--stdout', 'print instead of writing')
    .action(async (target: string, o: { out?: string; stdout?: boolean }) => {
      if (!(ENFORCEMENT_TARGETS as readonly string[]).includes(target))
        throw new CliError(
          `Unknown target "${target}". Targets: ${ENFORCEMENT_TARGETS.join(', ')}.`,
        );
      const generator = env.catalog.profiles
        .flatMap((p) => p.generators ?? [])
        .find((g) => g.id === target);
      if (!generator) throw new CliError(`The profile has no ${target} generator.`);
      const ws = env.workspace();
      const project = await env.project(ws);
      const config = await ws.readConfig();
      const root = resolve(ws.dir, config.codeRoot ?? '..');
      const out = generator.generate(project, {
        catalog: env.catalog,
        projectPath: relative(root, ws.fileFor(project.id)).split('\\').join('/'),
      });
      if (o.stdout) return env.io.out(out.content);
      const configured = config.exports?.find(
        (e) => e.format === target && (!e.project || e.project === project.id),
      );
      const file = resolve(ws.dir, o.out ?? configured?.out ?? out.path);
      await writeFileAtomic(file, out.content);
      if (env.global().json) return env.json({ written: file, rules: out.rules });
      env.info(`${paint.green('✓')} wrote ${env.shortPath(file)} (${out.rules.length} rule(s))`);
    });
}
