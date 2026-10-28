import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  applyChangeSetOps,
  changeSetFindings,
  createChangeSet,
  describeChanges,
  describeOp,
  dropOps,
  effectiveProject,
  generateTasks,
  rebaseChangeSet,
  storedChangeSet,
} from '@archguide/core';
import type { ChangeSet, Op, Project } from '@archguide/core';
import { applyToWorkspace } from '@archguide/workspace';
import type { Envelope, McpContext } from './context';
import { brief, fail, ok, projectIdOf, readProject } from './context';
import { run } from './tools';

const projectIdArg = z
  .string()
  .optional()
  .describe('Project ID. Defaults to the workspace default project, or the only project.');

/** Change-set tools (Implementation.md §16, §20.2): plan a feature on top of the baseline. */
export function registerChangeSetTools(server: McpServer, ctx: McpContext): void {
  const { catalog } = ctx;

  const write = async (p: Project, ops: Op[], data: unknown): Promise<Envelope> => {
    if (ctx.readOnly)
      return fail([
        {
          code: 'READ_ONLY',
          message: 'This MCP server runs with --read-only; write tools are off.',
        },
      ]);
    const r = await applyToWorkspace(ctx.workspace, catalog, p.id, ops, {
      origin: 'mcp',
      baseRevision: p.revision,
    });
    if (!r.ok) return fail(r.errors);
    return ok(data, { revision: r.revision });
  };

  const find = (p: Project, id: string): ChangeSet => {
    const cs = p.changeSets.find((c) => c.id === id);
    if (!cs)
      throw Object.assign(
        new Error(
          `No change set "${id}". Change sets: ${p.changeSets.map((c) => c.id).join(', ') || 'none'}.`,
        ),
        { code: 'NOT_FOUND' },
      );
    return cs;
  };

  server.registerTool(
    'create_change_set',
    {
      title: 'Start a change set',
      description:
        'A named change on top of the baseline: the plan of one feature. Pass its ID as changeSetId to upsert_elements, upsert_relations, apply_template and remove_items to record edits into it, and to validate_project and get_architecture to see baseline + change.',
      inputSchema: { projectId: projectIdArg, name: z.string().min(1), description: z.string() },
    },
    ({ projectId, name, description }) =>
      run(async () => {
        const p = await readProject(ctx, projectId);
        const changeSet = createChangeSet(p, { name, description });
        return write(p, [{ op: 'upsertChangeSet', changeSet: storedChangeSet(changeSet, p) }], {
          id: changeSet.id,
        });
      }),
  );

  server.registerTool(
    'list_change_sets',
    {
      title: 'List change sets',
      description: 'The change sets of a project with their status and size.',
      inputSchema: { projectId: projectIdArg },
      annotations: { readOnlyHint: true },
    },
    ({ projectId }) =>
      run(async () => {
        const p = await readProject(ctx, projectId);
        return ok(
          p.changeSets.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            ops: c.ops.length,
            tasks: c.tasks?.length ?? 0,
            stale: c.baseRevision < p.revision,
          })),
          { revision: p.revision },
        );
      }),
  );

  server.registerTool(
    'get_change_set',
    {
      title: 'Read a change set',
      description:
        'The change: its ops in words, the net changes, conflicts with the current baseline, the tasks, and the findings it introduces.',
      inputSchema: { projectId: projectIdArg, changeSetId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ projectId, changeSetId }) =>
      run(async () => {
        const p = await readProject(ctx, projectId);
        const cs = find(p, changeSetId);
        const state = effectiveProject(p, cs, catalog);
        const { introduced } = changeSetFindings(state, catalog);
        return ok(
          {
            id: cs.id,
            name: cs.name,
            description: cs.description,
            status: cs.status,
            baseRevision: cs.baseRevision,
            stale: state.stale,
            ops: cs.ops.map((op) => describeOp(op, state.effective)),
            changes: describeChanges(p, state.effective).map(
              (r) => `${r.op} ${r.item}${r.details ? ` — ${r.details}` : ''}`,
            ),
            conflicts: state.conflicts.map((c) => ({
              index: c.index,
              op: describeOp(c.op, p),
              code: c.code,
              message: c.message,
            })),
            tasks: cs.tasks ?? [],
            newFindings: introduced.filter((f) => !f.suppressed).map(brief),
          },
          {
            revision: p.revision,
            hints: [
              ...(state.conflicts.length
                ? [
                    `${state.conflicts.length} op(s) no longer apply to the baseline: fix the model or drop them (update_change_set dropOps).`,
                  ]
                : []),
              ...(cs.tasks?.length ? [] : ['generate_tasks orders the work.']),
            ],
          },
        );
      }),
  );

  server.registerTool(
    'generate_tasks',
    {
      title: 'Generate the tasks',
      description:
        'Orders the work of a change set (data first, then ports, domain, adapters, use cases, handlers, services, BFF, frontend), one task per element with sub-steps and invariants, and stores the tasks in the change set. Ticked tasks stay ticked.',
      inputSchema: { projectId: projectIdArg, changeSetId: z.string() },
    },
    ({ projectId, changeSetId }) =>
      run(async () => {
        const p = await readProject(ctx, projectId);
        const cs = find(p, changeSetId);
        const tasks = generateTasks(p, cs, catalog);
        return write(
          p,
          [{ op: 'upsertChangeSet', changeSet: storedChangeSet({ ...cs, tasks }, p) }],
          tasks,
        );
      }),
  );

  server.registerTool(
    'update_change_set',
    {
      title: 'Update a change set',
      description:
        'Rename it, set its status (ready, abandoned; "implemented" merges the ops into the baseline and is refused while ops conflict), drop conflicting ops by index, or rebase it on the current baseline.',
      inputSchema: {
        projectId: projectIdArg,
        changeSetId: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        status: z.enum(['draft', 'ready', 'implemented', 'abandoned']).optional(),
        dropOps: z.array(z.number().int().min(0)).optional(),
        rebase: z.boolean().optional(),
      },
    },
    ({ projectId, changeSetId, name, description, status, dropOps: drop, rebase }) =>
      run(async () => {
        const p = await readProject(ctx, await projectIdOf(ctx, projectId));
        let cs = find(p, changeSetId);
        if (drop?.length) cs = dropOps(cs, drop);
        if (rebase) cs = rebaseChangeSet(p, cs, catalog).changeSet;
        cs = {
          ...cs,
          ...(name ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
        };
        if (status === 'implemented') {
          const r = applyChangeSetOps(p, cs, catalog);
          if (!r.ok)
            return fail(
              r.conflicts.map((c) => ({
                code: c.code,
                index: c.index,
                message: `Op ${c.index} (${describeOp(c.op, p)}): ${c.message}`,
              })),
              ['Drop or fix the conflicting ops first (dropOps, or edit the baseline).'],
            );
          return write(p, r.ops, { id: cs.id, status: 'implemented', merged: cs.ops.length });
        }
        if (status) cs = { ...cs, status };
        return write(p, [{ op: 'upsertChangeSet', changeSet: storedChangeSet(cs, p) }], {
          id: cs.id,
          status: cs.status,
          ops: cs.ops.length,
        });
      }),
  );
}
