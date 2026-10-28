import {
  appendOps,
  applyOps,
  effectiveProject,
  placeMissingOps,
  runRules,
  storedChangeSet,
} from '@archguide/core';
import type {
  Catalog,
  ChangeSet,
  Finding,
  Id,
  ModelOp,
  Op,
  OpError,
  Project,
} from '@archguide/core';
import { countFindings, newFindings } from '@archguide/core';
import { applyToWorkspace, readFromWorkspace } from '@archguide/workspace';
import type { Workspace } from '@archguide/workspace';

export interface McpContext {
  workspace: Workspace;
  catalog: Catalog;
  /** `--read-only`: write tools refuse (§20.5). */
  readOnly: boolean;
  /** `--repo`: the code to analyze (default: the workspace's codeRoot). */
  repo?: string;
}

/** Errors in tool results: op errors, or tool-level ones with their own codes. */
export type ToolError = Omit<OpError, 'code' | 'index'> & { code: string; index?: number };

/** The response envelope of every tool (Implementation.md §20.1). */
export type Envelope =
  | {
      ok: true;
      revision?: number;
      changed?: Id[];
      findings?: BriefFinding[];
      data?: unknown;
      hints?: string[];
    }
  | { ok: false; errors: ToolError[]; hints?: string[] };

export interface BriefFinding {
  ruleId: string;
  severity: Finding['severity'];
  title: string;
  message: string;
  targetIds: Id[];
  /** Titles of the quick fixes; apply one with apply_quick_fix and its index. */
  fixes: string[];
}

export const brief = (f: Finding): BriefFinding => ({
  ruleId: f.ruleId,
  severity: f.severity,
  title: f.title,
  message: f.message,
  targetIds: f.targetIds,
  fixes: f.fixes.map((x) => x.title),
});

export const fail = (errors: ToolError[], hints?: string[]): Envelope => ({
  ok: false,
  errors,
  ...(hints ? { hints } : {}),
});

export const ok = (
  data?: unknown,
  extra: Omit<Extract<Envelope, { ok: true }>, 'ok' | 'data'> = {},
): Envelope => ({
  ok: true,
  ...(data === undefined ? {} : { data }),
  ...extra,
});

export function findingsSummary(findings: readonly Finding[]): string {
  const c = countFindings(findings);
  return `The project has ${c.error} error(s), ${c.warning} warning(s) and ${c.info} tip(s) in total; validate_project lists them.`;
}

export async function projectIdOf(ctx: McpContext, projectId?: string): Promise<string> {
  return ctx.workspace.resolveProjectId(projectId);
}

export async function readProject(ctx: McpContext, projectId?: string): Promise<Project> {
  return readFromWorkspace(ctx.workspace, await projectIdOf(ctx, projectId));
}

/**
 * The model a tool reads: the baseline, or baseline + change set when `changeSetId` is set.
 * Refuses a change set that is not open (implemented or abandoned).
 */
export async function readModel(
  ctx: McpContext,
  projectId: string | undefined,
  changeSetId?: Id,
): Promise<{ baseline: Project; project: Project; changeSet?: ChangeSet }> {
  const baseline = await readProject(ctx, projectId);
  if (!changeSetId) return { baseline, project: baseline };
  const changeSet = baseline.changeSets.find((c) => c.id === changeSetId);
  if (!changeSet)
    throw Object.assign(
      new Error(
        `No change set "${changeSetId}". Open ones: ${baseline.changeSets.map((c) => c.id).join(', ') || 'none'} (create_change_set makes one).`,
      ),
      { code: 'NOT_FOUND' },
    );
  return {
    baseline,
    project: effectiveProject(baseline, changeSet, ctx.catalog).effective,
    changeSet,
  };
}

/**
 * The write path of every tool: build ops from the current project, place new shapes in
 * the first view (so the browser shows them), apply through the running server or the file,
 * and report only the findings the change introduced (§20.1). With `changeSetId`, the ops
 * are recorded into the change set instead: the tool sees and checks baseline + change, and
 * the baseline stays as it is (§16.1).
 */
export async function change(
  ctx: McpContext,
  projectId: string | undefined,
  build: (p: Project) => { ops: ModelOp[]; ids?: Id[]; errors?: ToolError[]; data?: unknown },
  options: { changeSetId?: Id } = {},
): Promise<Envelope> {
  if (ctx.readOnly)
    return fail([
      { code: 'READ_ONLY', message: 'This MCP server runs with --read-only; write tools are off.' },
    ]);
  const id = await projectIdOf(ctx, projectId);
  const { baseline, project: before, changeSet } = await readModel(ctx, id, options.changeSetId);
  if (changeSet && (changeSet.status === 'implemented' || changeSet.status === 'abandoned'))
    return fail([
      {
        code: 'CHANGE_SET_CLOSED',
        message: `Change set "${changeSet.id}" is ${changeSet.status}.`,
      },
    ]);
  const built = build(before);
  if (built.errors?.length) return fail(built.errors);
  if (built.ops.length === 0) return ok(built.data, { revision: baseline.revision, changed: [] });
  const trial = applyOps(before, built.ops, ctx.catalog);
  if (!trial.ok) return fail(trial.errors, hintsFor(trial.errors));
  const ops = [...built.ops, ...placeMissingOps(trial.project, ctx.catalog)];
  const recorded = changeSet
    ? storedChangeSet({ ...changeSet, ops: appendOps(changeSet.ops, ops) }, baseline)
    : undefined;
  const write: Op[] = recorded ? [{ op: 'upsertChangeSet', changeSet: recorded }] : ops;
  const r = await applyToWorkspace(ctx.workspace, ctx.catalog, id, write, {
    origin: 'mcp',
    baseRevision: baseline.revision,
  });
  if (!r.ok) return fail(r.errors, hintsFor(r.errors));
  const afterProject = recorded
    ? effectiveProject(r.project, recorded, ctx.catalog).effective
    : r.project;
  const after = runRules(afterProject, ctx.catalog);
  const introduced = newFindings(runRules(before, ctx.catalog), after);
  return ok(built.data, {
    revision: r.revision,
    changed: built.ids ?? [],
    findings: introduced.map(brief),
    hints: [
      findingsSummary(after),
      ...(recorded
        ? [
            `Recorded into change set "${recorded.id}" (${recorded.ops.length} ops); the baseline is unchanged.`,
          ]
        : []),
    ],
  });
}

function hintsFor(errors: readonly ToolError[]): string[] | undefined {
  const hints = errors.flatMap((e) =>
    e.fix ? [`Error ${e.code}: a fix is attached (ops in "fix").`] : [],
  );
  return hints.length ? hints : undefined;
}
