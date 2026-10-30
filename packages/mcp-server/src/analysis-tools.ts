import { relative, resolve } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ENFORCEMENT_TARGETS, markAsFound, matchModel, selectSuggestions } from '@archguide/core';
import type { AnalysisResult } from '@archguide/core';
import {
  analysisDir,
  analyzeRepository,
  introspectDatabase,
  readAnalysis,
  readRejected,
  writeAnalysis,
} from '@archguide/analyzer';
import { writeFileAtomic } from '@archguide/workspace';
import type { McpContext } from './context';
import { change, fail, ok, readProject } from './context';
import { run } from './tools';

const projectIdArg = z
  .string()
  .optional()
  .describe('Project ID. Defaults to the workspace default project.');

/** What an agent needs from a run, without the full fact list (that stays in last.json). */
function summarize(r: AnalysisResult) {
  const byKind: Record<string, number> = {};
  for (const e of r.candidates.elements) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  return {
    stats: r.stats,
    durationMs: r.durationMs,
    candidates: byKind,
    elements: r.candidates.elements.map((e) => ({
      id: e.id,
      kind: e.kind,
      name: e.name,
      ...(e.parentId ? { parentId: e.parentId } : {}),
      confidence: e.source?.confidence,
      evidence: e.source?.evidence
        ?.slice(0, 2)
        .map((x) => `${x.path}${x.line ? `:${x.line}` : ''}`),
    })),
    relations: r.candidates.relations.map(
      (x) => `${x.sourceId} -${x.type}-> ${x.targetId}${x.antiPattern ? ' (anti-pattern)' : ''}`,
    ),
    /** What the code does that the rules refuse: kept in the draft, marked, to address. */
    antiPatterns: [...r.candidates.elements, ...r.candidates.relations]
      .filter((x) => x.antiPattern)
      .map((x) => ({
        id: x.id,
        note: x.antiPattern!.note,
        ...(x.antiPattern!.violates ? { violates: x.antiPattern!.violates } : {}),
      })),
    findings: r.findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      message: f.message,
      targetIds: f.targetIds,
      evidence: f.evidence.slice(0, 3).map((x) => `${x.path}${x.line ? `:${x.line}` : ''}`),
    })),
    ...(r.diff
      ? {
          diff: {
            newInCode: r.diff.newInCode,
            missingInCode: r.diff.missingInCode,
            changed: r.diff.changed,
            suggestedOps: r.diff.suggestedOps.length,
          },
        }
      : {}),
    warnings: r.warnings,
  };
}

/** Analysis tools (Implementation.md §20.2): analyze, apply, diff and generate enforcement. */
export function registerAnalysisTools(server: McpServer, ctx: McpContext): void {
  const { catalog, workspace: ws } = ctx;
  const codeRoot = async (path?: string) => {
    if (path) return resolve(ctx.repo ?? resolve(ws.dir, '..'), path);
    if (ctx.repo) return ctx.repo;
    const config = (await ws.exists()) ? await ws.readConfig() : {};
    return resolve(ws.dir, config.codeRoot ?? '..');
  };
  const analyze = async (
    path: string | undefined,
    projectId: string | undefined,
    extra: { include?: string[]; exclude?: string[]; db?: boolean } = {},
  ) => {
    const hasProject = (await ws.exists()) && (await ws.listProjects()).length > 0;
    const project = hasProject ? await readProject(ctx, projectId) : undefined;
    let extraFacts: Awaited<ReturnType<typeof introspectDatabase>> = [];
    if (extra.db) {
      const url = process.env.ARCHGUIDE_DATABASE_URL_READONLY;
      if (!url)
        throw Object.assign(
          new Error(
            'db: true needs ARCHGUIDE_DATABASE_URL_READONLY in the MCP server environment.',
          ),
          { code: 'CONFIG' },
        );
      extraFacts = await introspectDatabase({ url });
    }
    const result = await analyzeRepository(await codeRoot(path), {
      catalog,
      ...(project ? { model: project.model } : {}),
      ...(extra.include ? { include: extra.include } : {}),
      ...(extra.exclude ? { exclude: extra.exclude } : {}),
      ...((await ws.exists())
        ? { rejected: await readRejected(ws.dir), cacheDir: resolve(analysisDir(ws.dir), 'cache') }
        : {}),
      extraFacts,
    });
    if (await ws.exists()) await writeAnalysis(ws.dir, result);
    return { result, project };
  };

  server.registerTool(
    'analyze_repository',
    {
      title: 'Analyze the repository',
      description:
        'Reads the repository (no code is run) and drafts the architecture with evidence: deployables, routes, handlers, modules, state, schemas, tables, queues, calls and data ownership, plus findings with file and line. Reads TypeScript/JavaScript (React, Node), Python (FastAPI, Flask, Django, Celery …) and .NET (ASP.NET Core, EF Core, worker services …). What the code does against the rules is kept in the draft as anti-patterns (antiPatterns). Compared with the project when there is one. The full result is saved to .archguide/analysis/last.json; apply it with apply_analysis.',
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe('Folder to analyze (default: the workspace code root).'),
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        db: z
          .boolean()
          .default(false)
          .describe(
            'Also read the live database catalog (read-only; URL from ARCHGUIDE_DATABASE_URL_READONLY).',
          ),
        projectId: projectIdArg,
      },
      annotations: { readOnlyHint: true },
    },
    ({ path, include, exclude, db, projectId }) =>
      run(async () => {
        const { result } = await analyze(path, projectId, {
          ...(include ? { include } : {}),
          ...(exclude ? { exclude } : {}),
          db,
        });
        return ok(summarize(result), {
          hints: [
            result.diff
              ? `${result.diff.suggestedOps.length} suggested change(s). Review the elements, then apply_analysis (accept "all" or a list of IDs).`
              : 'No project yet: create_project, then apply_analysis.',
          ],
        });
      }),
  );

  server.registerTool(
    'apply_analysis',
    {
      title: 'Apply the analysis',
      description:
        'Adds the elements and relations of the last analysis to the project, as inferred and not yet reviewed by a person. Matched against the current model first, so nothing is added twice and nothing is removed. What the code does against the rules is added as found, marked as anti-patterns to address (rule AP-019).',
      inputSchema: {
        projectId: projectIdArg,
        accept: z.union([z.literal('all'), z.array(z.string()).min(1)]).default('all'),
        minConfidence: z.number().min(0).max(1).default(0.6),
      },
    },
    ({ projectId, accept, minConfidence }) =>
      run(async () => {
        const last = await readAnalysis(ws.dir);
        if (!last)
          return fail([
            {
              code: 'NOT_FOUND',
              message: 'No analysis yet.',
              hint: 'Run analyze_repository first.',
            },
          ]);
        return change(ctx, projectId, (p) => {
          const diff = matchModel(p.model, last.candidates, {
            detectableKinds: new Set(last.candidates.elements.map((e) => e.kind)),
          });
          const { ops } = markAsFound(
            p,
            catalog,
            selectSuggestions(diff, { accept, minConfidence }),
          );
          const antiPatterns = ops.flatMap((o) =>
            (o.op === 'addElement' && o.element.antiPattern) ||
            (o.op === 'addRelation' && o.relation.antiPattern)
              ? [o.op === 'addElement' ? o.element.id : o.relation.id]
              : [],
          );
          return {
            ops,
            ids: ops.flatMap((o) =>
              o.op === 'addElement'
                ? [o.element.id]
                : o.op === 'addRelation'
                  ? [o.relation.id]
                  : o.op === 'updateElement'
                    ? [o.id]
                    : [],
            ),
            data: {
              applied: ops.length,
              skipped: diff.suggestedOps.length - ops.length,
              ...(antiPatterns.length
                ? {
                    antiPatterns,
                    note: 'The code has these anti-patterns; they are in the model as found, and rule AP-019 reports them until they are addressed.',
                  }
                : {}),
            },
          };
        });
      }),
  );

  server.registerTool(
    'diff_with_repository',
    {
      title: 'Compare the model with the code',
      description:
        'What the code has that the model does not (newInCode), what the model says exists but the code no longer shows (missingInCode), changed items, and the findings about the code (with file and line).',
      inputSchema: { projectId: projectIdArg, path: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ projectId, path }) =>
      run(async () => {
        const { result, project } = await analyze(path, projectId);
        if (!project)
          return fail([
            {
              code: 'NOT_FOUND',
              message: 'No project to compare with.',
              hint: 'create_project first.',
            },
          ]);
        const d = result.diff!;
        const name = (id: string) =>
          project.model.elements.find((e) => e.id === id)?.name ??
          d.suggestedOps.flatMap((o) =>
            o.op === 'addElement' && o.element.id === id ? [o.element.name] : [],
          )[0] ??
          id;
        return ok(
          {
            newInCode: d.newInCode.map((id) => ({ id, name: name(id) })),
            missingInCode: d.missingInCode.map((id) => ({ id, name: name(id) })),
            changed: d.changed,
            findings: summarize(result).findings,
          },
          { revision: project.revision },
        );
      }),
  );

  server.registerTool(
    'generate_enforcement',
    {
      title: 'Generate enforcement config',
      description:
        'Turns the model into rules a standard tool checks in CI: dependency-cruiser (default), Nx module boundaries or ArchUnitTS tests. With write: true, writes the file into the workspace folder (.archguide/…, or the path in archguide.config.json exports).',
      inputSchema: {
        projectId: projectIdArg,
        target: z.enum(ENFORCEMENT_TARGETS).default('dependency-cruiser'),
        write: z.boolean().default(false),
      },
    },
    ({ projectId, target, write }) =>
      run(async () => {
        const generator = catalog.profiles
          .flatMap((x) => x.generators ?? [])
          .find((g) => g.id === target);
        if (!generator) return fail([{ code: 'NOT_FOUND', message: `No ${target} generator.` }]);
        const p = await readProject(ctx, projectId);
        const config = await ws.readConfig();
        const root = resolve(ws.dir, config.codeRoot ?? '..');
        const out = generator.generate(p, {
          catalog,
          projectPath: relative(root, ws.fileFor(p.id)).split('\\').join('/'),
        });
        if (!write)
          return ok(out.content, {
            revision: p.revision,
            hints: [`${out.rules.length} rule(s): ${out.rules.join(', ')}`],
          });
        if (ctx.readOnly)
          return fail([{ code: 'READ_ONLY', message: 'Writing files is off (--read-only).' }]);
        const configured = config.exports?.find(
          (e) => e.format === target && (!e.project || e.project === p.id),
        );
        const file = resolve(ws.dir, configured?.out ?? out.path);
        await writeFileAtomic(file, out.content);
        return ok({ written: file, rules: out.rules }, { revision: p.revision });
      }),
  );
}
