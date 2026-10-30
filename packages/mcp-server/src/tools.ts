import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  EXPORT_FORMATS,
  LevelSchema,
  TRACKS,
  TrackSchema,
  allTemplates,
  catalogDocs,
  catalogLessons,
  catalogSummary,
  checkStep,
  documentationOps,
  draftTour,
  markAsFound,
  explainText,
  exportProject,
  findingKey,
  newFindings,
  newProject,
  removeItemsOps,
  runRules,
  searchDocs,
  serializeProject,
  slugify,
  storedChangeSet,
  templateOps,
  uniqueId,
  upsertElementsOps,
  upsertRelationsOps,
  viewNodeSize,
} from '@archguide/core';
import type { Catalog, ModelOp, Project, Tour } from '@archguide/core';
import {
  applyToWorkspace,
  createInWorkspace,
  exportFiles,
  writeExport,
} from '@archguide/workspace';
import type { Envelope, McpContext, ToolError } from './context';
import { brief, change, fail, findingsSummary, ok, readModel, readProject } from './context';

const PLAN_FORMATS: readonly string[] = ['plan-md', 'speckit', 'kiro'];

/** Tool results: the envelope as JSON, and long texts as their own block for reading. */
export function toResult(env: Envelope): CallToolResult {
  const text = env.ok && typeof env.data === 'string' ? env.data : undefined;
  const shown = text === undefined ? env : { ...env, data: '(the text follows in the next block)' };
  return {
    content: [
      { type: 'text', text: JSON.stringify(shown, null, 2) },
      ...(text === undefined ? [] : [{ type: 'text' as const, text }]),
    ],
    structuredContent: env as unknown as Record<string, unknown>,
    ...(env.ok ? {} : { isError: true }),
  };
}

/** Runs a tool body and turns thrown errors into a failed envelope. */
export async function run(body: () => Promise<Envelope>): Promise<CallToolResult> {
  try {
    return toResult(await body());
  } catch (error) {
    const e = error as Error & { code?: string };
    return toResult(fail([{ code: e.code ?? 'ERROR', message: e.message }]));
  }
}

const changeSetIdArg = z
  .string()
  .optional()
  .describe(
    'Change set ID (create_change_set): read or edit baseline + change set; edits are recorded into it, the baseline stays.',
  );

const projectIdArg = z
  .string()
  .optional()
  .describe('Project ID. Defaults to the workspace default project, or the only project.');

const langArg = z
  .string()
  .describe(
    'BCP 47 tag of the language you write the texts in ("en", "de", "sr-Latn", "ja"). Write in the language of the repository\'s own documentation; the editor shows the texts as written and never translates them.',
  );

/** Documentation fields; write_documentation also takes null, which removes a field. */
const docsFields = {
  name: z.string().describe('The name the documentation uses for the block; shown on the canvas.'),
  description: z.string().describe('What the block is.'),
  function: z.string().describe('What the block does: its function in the system.'),
  basis: z
    .enum(['read', 'deduced'])
    .describe('read: taken from the repository documentation; deduced: inferred from the code.'),
  sources: z
    .array(z.string())
    .describe('Files you read or deduced it from, relative to the repository root.'),
};

const docsInput = z
  .object({
    lang: langArg.optional(),
    name: docsFields.name.optional(),
    description: docsFields.description.optional(),
    function: docsFields.function.optional(),
    basis: docsFields.basis.optional(),
    sources: docsFields.sources.optional(),
  })
  .describe(
    "Documentation of the block in the repository's own words and language (see write_documentation).",
  );

const antiPatternInput = z
  .object({
    note: z
      .string()
      .min(1)
      .describe(
        'What the code does and why it is a problem, e.g. "The web app queries Postgres directly."',
      ),
    evidence: z
      .array(
        z.object({
          path: z.string().min(1),
          line: z.number().int().positive().optional(),
          symbol: z.string().optional(),
        }),
      )
      .optional()
      .describe('Where the code does it.'),
  })
  .describe(
    'Marks the item as an anti-pattern found in the analyzed code. It is kept even where the rules refuse it (the diagram stays faithful to the code) and reported by rule AP-019 until it is addressed.',
  );

const asFoundArg = z
  .boolean()
  .default(false)
  .describe(
    'Record the code as it is (mapping an existing repository): items the rules refuse are kept with an anti-pattern mark that names the broken rule, instead of being refused. Prefer an antiPattern note per item, which says what the code does.',
  );

const elementInput = z.looseObject({
  id: z
    .string()
    .optional()
    .describe('Known ID: update. New or missing: create (an ID is generated).'),
  kind: z.string().describe('Concept ID, e.g. "node.service". get_catalog lists them.'),
  name: z.string(),
  parentId: z
    .string()
    .nullable()
    .optional()
    .describe('Container element; null moves to top level.'),
  description: z.string().optional(),
  responsibilities: z.array(z.string()).optional(),
  tech: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['planned', 'existing', 'deprecated']).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  codePaths: z.array(z.string()).optional(),
  docs: docsInput.optional(),
  antiPattern: antiPatternInput.optional(),
});

const relationInput = z.looseObject({
  id: z.string().optional(),
  type: z
    .string()
    .optional()
    .describe(
      'Relation type. Leave it out when only one type fits; otherwise the error lists them.',
    ),
  sourceId: z.string(),
  targetId: z.string(),
  label: z.string().optional(),
  protocol: z.string().optional(),
  via: z.string().optional(),
  inTransaction: z.boolean().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['planned', 'existing', 'deprecated']).optional(),
  antiPattern: antiPatternInput.optional(),
});

const tourInput = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  audience: z.enum(['any', 'beginner', 'intermediate', 'senior', 'agent']),
  steps: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      body: z.string(),
      elementIds: z.array(z.string()).default([]),
      relationIds: z.array(z.string()).default([]),
      conceptIds: z.array(z.string()).optional(),
    }),
  ),
});

/** Where a stamped template goes: to the right of the top-level shapes of the first view. */
function stampOrigin(p: Project, catalog: Catalog) {
  const view = p.views[0];
  if (!view || view.nodes.length === 0) return { x: 40, y: 40 };
  const parentOf = new Map(p.model.elements.map((e) => [e.id, e.parentId]));
  const shown = new Set(view.nodes.map((n) => n.elementId));
  const right = Math.max(
    ...view.nodes
      .filter((n) => {
        const parent = parentOf.get(n.elementId);
        return !parent || !shown.has(parent);
      })
      .map((n) => n.x + viewNodeSize(p, view, catalog, n.elementId).w),
  );
  return { x: right + 120, y: 40 };
}

export function registerTools(server: McpServer, ctx: McpContext): void {
  const { catalog } = ctx;
  /** Keeps refused items as marked anti-patterns (asFound), and names them in the result. */
  const asFoundEdit = (
    p: Project,
    edit: { ops: ModelOp[]; ids: string[]; errors: ToolError[] },
    asFound: boolean,
  ) => {
    const { ops, marked } = markAsFound(p, catalog, edit.ops, { asFound });
    return {
      ...edit,
      ops,
      ...(marked.length
        ? {
            data: {
              antiPatterns: marked,
              note: 'Kept as anti-patterns found in the code (rule AP-019 reports them until they are addressed).',
            },
          }
        : {}),
    };
  };
  const ws = ctx.workspace;

  // --- reading the model ---------------------------------------------------------------

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'Projects in the workspace (architecture/*.archguide.json) with their size.',
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const entries = await ws.listProjects();
        const config = await ws.readConfig();
        const projects = await Promise.all(
          entries.map(async (e) => {
            const p = await readProject(ctx, e.id);
            return {
              id: p.id,
              name: p.name,
              revision: p.revision,
              elements: p.model.elements.length,
              relations: p.model.relations.length,
              default: config.defaultProject === p.id,
            };
          }),
        );
        return ok(projects, {
          hints: projects.length ? [] : ['The workspace has no projects yet: use create_project.'],
        });
      }),
  );

  server.registerTool(
    'get_architecture',
    {
      title: 'Read the architecture',
      description:
        'The model as agent Markdown (elements, relations, data ownership, invariants, known issues, decisions), agent YAML, or the project JSON. Use focus + depth for one area.',
      inputSchema: {
        projectId: projectIdArg,
        format: z.enum(['agent-md', 'agent-yaml', 'json']).default('agent-md'),
        focus: z.string().optional().describe('Element ID: only its neighborhood.'),
        depth: z.number().int().min(1).max(5).default(1),
        changeSetId: changeSetIdArg,
      },
      annotations: { readOnlyHint: true },
    },
    ({ projectId, format, focus, depth, changeSetId }) =>
      run(async () => {
        const { project: p } = await readModel(ctx, projectId, changeSetId);
        if (format === 'json') return ok(serializeProject(p), { revision: p.revision });
        const file = exportProject(format, p, catalog, focus ? { focus, depth } : {}).files[0]!;
        return ok(file.content, { revision: p.revision });
      }),
  );

  server.registerTool(
    'get_catalog',
    {
      title: 'Concepts and relation types',
      description:
        'What can be modeled: concepts (kinds) with allowed parents and properties (JSON Schema), relation types, and — with a filter — which relation types connect which concepts. Filter: "react.", "node.service", "category:data-at-rest", "group:Backend".',
      inputSchema: { filter: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ filter }) => run(async () => ok(catalogSummary(catalog, filter))),
  );

  server.registerTool(
    'list_templates',
    {
      title: 'List templates',
      description:
        'Architecture templates (layered, hexagonal, BFF, background jobs …) with their parameters.',
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () =>
        ok(
          allTemplates(catalog).map((t) => ({
            id: t.id,
            code: t.code,
            name: t.name,
            summary: t.summary,
            parameters: t.parameters,
            invariants: t.invariants,
          })),
        ),
      ),
  );

  // --- changing the model ----------------------------------------------------------------

  server.registerTool(
    'create_project',
    {
      title: 'Create a project',
      description: 'Creates an empty project, or one from a template (list_templates).',
      inputSchema: {
        id: z.string().optional().describe('Defaults to a slug of the name.'),
        name: z.string(),
        description: z.string().optional(),
        templateId: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      },
    },
    ({ id, name, description, templateId, params }) =>
      run(async () => {
        if (ctx.readOnly)
          return fail([{ code: 'READ_ONLY', message: 'Write tools are off (--read-only).' }]);
        const r = newProject(catalog, { id, name, description, templateId, params });
        if ('errors' in r) return fail(r.errors);
        const { project } = r;
        await createInWorkspace(ws, project);
        const config = await ws.readConfig();
        if (!config.defaultProject)
          await ws.writeConfig({ profile: project.profile, ...config, defaultProject: project.id });
        return ok(
          { id: project.id, name: project.name, elements: project.model.elements.length },
          { revision: project.revision, changed: project.model.elements.map((e) => e.id) },
        );
      }),
  );

  server.registerTool(
    'apply_template',
    {
      title: 'Apply a template',
      description: "Adds a template's elements and relations to a project, next to what is there.",
      inputSchema: {
        projectId: projectIdArg,
        templateId: z.string().describe('Template ID or code (T1 …).'),
        params: z.record(z.string(), z.unknown()).optional(),
        parentId: z.string().optional().describe('Element to put the template inside.'),
        changeSetId: changeSetIdArg,
      },
    },
    ({ projectId, templateId, params, parentId, changeSetId }) =>
      run(() =>
        change(
          ctx,
          projectId,
          (p) => {
            const r = templateOps(catalog, p, templateId, {
              params,
              origin: stampOrigin(p, catalog),
              ...(parentId ? { parentId } : {}),
            });
            if ('errors' in r) return { ops: [], errors: r.errors };
            return { ops: r.ops, ids: [...r.ids.values()], data: Object.fromEntries(r.ids) };
          },
          { changeSetId },
        ),
      ),
  );

  server.registerTool(
    'upsert_elements',
    {
      title: 'Add or update elements',
      description:
        'Creates elements (no id, or a new one) or updates them (a known id). Later items can use IDs created earlier in the same call as parentId. Returns the IDs and only the findings this change introduced. When mapping existing code, an element the code puts where the rules do not allow is kept with an antiPattern note (or asFound: true).',
      inputSchema: {
        projectId: projectIdArg,
        elements: z.array(elementInput).min(1).max(200),
        asFound: asFoundArg,
        changeSetId: changeSetIdArg,
      },
    },
    ({ projectId, elements, asFound, changeSetId }) =>
      run(() =>
        change(
          ctx,
          projectId,
          (p) => asFoundEdit(p, upsertElementsOps(p, catalog, elements as never), asFound),
          { changeSetId },
        ),
      ),
  );

  server.registerTool(
    'upsert_relations',
    {
      title: 'Add or update relations',
      description:
        'Connects elements. Without "type", the only valid type is used; when several fit, the error lists them. A refused pair explains why and, where possible, offers the reversed relation as a fix. When mapping existing code that really does what the rules refuse, keep it faithful: give the type the code uses and an antiPattern note (or asFound: true); it is kept and reported as an anti-pattern to address.',
      inputSchema: {
        projectId: projectIdArg,
        relations: z.array(relationInput).min(1).max(400),
        asFound: asFoundArg,
        changeSetId: changeSetIdArg,
      },
    },
    ({ projectId, relations, asFound, changeSetId }) =>
      run(() =>
        change(
          ctx,
          projectId,
          (p) => asFoundEdit(p, upsertRelationsOps(p, catalog, relations as never), asFound),
          { changeSetId },
        ),
      ),
  );

  server.registerTool(
    'remove_items',
    {
      title: 'Remove elements or relations',
      description:
        'Removes elements (with their children and relations when cascade is true) and relations.',
      inputSchema: {
        projectId: projectIdArg,
        ids: z.array(z.string()).min(1),
        cascade: z.boolean().default(true),
        changeSetId: changeSetIdArg,
      },
      annotations: { destructiveHint: true },
    },
    ({ projectId, ids, cascade, changeSetId }) =>
      run(() => change(ctx, projectId, (p) => removeItemsOps(p, ids, cascade), { changeSetId })),
  );

  server.registerTool(
    'rename_id',
    {
      title: 'Rename an ID',
      description: 'Changes an element or relation ID everywhere it is used.',
      inputSchema: { projectId: projectIdArg, from: z.string(), to: z.string() },
    },
    ({ projectId, from, to }) =>
      run(() => change(ctx, projectId, () => ({ ops: [{ op: 'renameId', from, to }], ids: [to] }))),
  );

  server.registerTool(
    'write_documentation',
    {
      title: 'Write the documentation',
      description:
        "Stores the documentation of the analyzed repository: for the project (its language, a summary) and per element (name, description, function), as you read it in the repository (README, docs, comments) or deduced it from the code. Write in the language of the repository's documentation and set lang; the editor shows the name, description and function on the diagram as written, never translated. A field left out stays; null removes it.",
      inputSchema: {
        projectId: projectIdArg,
        project: z
          .object({
            lang: langArg.optional().describe('Required the first time. ' + langArg.description),
            summary: z.string().nullable().optional().describe('What the system is and does.'),
            author: z.string().nullable().optional().describe('Who wrote it, e.g. "claude-code".'),
            sources: z.array(z.string()).nullable().optional(),
          })
          .optional(),
        elements: z
          .array(
            z.object({
              id: z.string().describe('Element ID (get_architecture lists them).'),
              lang: langArg
                .nullable()
                .optional()
                .describe('Only when it differs from the project language.'),
              name: docsFields.name.nullable().optional(),
              description: docsFields.description.nullable().optional(),
              function: docsFields.function.nullable().optional(),
              basis: docsFields.basis.nullable().optional(),
              sources: docsFields.sources.nullable().optional(),
            }),
          )
          .max(400)
          .optional(),
        changeSetId: changeSetIdArg,
      },
    },
    ({ projectId, project, elements, changeSetId }) =>
      run(() =>
        change(
          ctx,
          projectId,
          (p) => {
            const r = documentationOps(p, {
              ...(project ? { project } : {}),
              ...(elements ? { elements } : {}),
            });
            return { ...r, data: { documented: r.ids.length } };
          },
          { changeSetId },
        ),
      ),
  );

  server.registerTool(
    'add_note',
    {
      title: 'Add a note',
      description: 'A project note in Markdown; @id mentions link elements.',
      inputSchema: {
        projectId: projectIdArg,
        title: z.string(),
        body: z.string(),
        linkedIds: z.array(z.string()).default([]),
      },
    },
    ({ projectId, title, body, linkedIds }) =>
      run(() =>
        change(ctx, projectId, (p) => {
          const id = uniqueId(`note.${slugify(title)}`, new Set(p.notes.map((n) => n.id)));
          return {
            ops: [
              {
                op: 'upsertNote',
                note: { id, title, body, linkedIds, updatedAt: new Date().toISOString() },
              },
            ],
            ids: [id],
          };
        }),
      ),
  );

  server.registerTool(
    'add_decision',
    {
      title: 'Record a decision',
      description: 'An architecture decision record (context, decision, consequences).',
      inputSchema: {
        projectId: projectIdArg,
        title: z.string(),
        status: z.enum(['proposed', 'accepted', 'superseded', 'rejected']).default('accepted'),
        context: z.string(),
        decision: z.string(),
        consequences: z.string(),
        linkedIds: z.array(z.string()).default([]),
      },
    },
    ({ projectId, ...d }) =>
      run(() =>
        change(ctx, projectId, (p) => {
          const id = uniqueId(`adr.${slugify(d.title)}`, new Set(p.decisions.map((x) => x.id)));
          return {
            ops: [{ op: 'upsertDecision', decision: { id, ...d, date: new Date().toISOString() } }],
            ids: [id],
          };
        }),
      ),
  );

  server.registerTool(
    'add_annotation',
    {
      title: 'Annotate the canvas',
      description:
        'A sticky note, a callout or a comment on an element (anchorId), shown on the canvas.',
      inputSchema: {
        projectId: projectIdArg,
        viewId: z.string().optional(),
        kind: z.enum(['sticky', 'callout', 'comment']),
        text: z.string(),
        anchorId: z.string().optional().describe('Element the callout or comment points at.'),
      },
    },
    ({ projectId, viewId, kind, text, anchorId }) =>
      run(() =>
        change(ctx, projectId, (p) => {
          const view = p.views.find((v) => v.id === viewId) ?? p.views[0]!;
          if (kind !== 'sticky' && !anchorId)
            return {
              ops: [],
              errors: [{ code: 'SCHEMA_INVALID', message: `A ${kind} needs an anchorId.` }],
            };
          const id = uniqueId(`ann.${kind}`, new Set(view.annotations.map((a) => a.id)));
          const anchor = anchorId ? { elementId: anchorId } : { x: 40, y: -160, w: 200, h: 120 };
          return {
            ops: [
              {
                op: 'upsertAnnotation',
                viewId: view.id,
                annotation: {
                  id,
                  kind,
                  text,
                  anchor,
                  author: 'agent',
                  createdAt: new Date().toISOString(),
                },
              },
            ],
            ids: [id],
          };
        }),
      ),
  );

  // --- rules ---------------------------------------------------------------------------

  server.registerTool(
    'validate_project',
    {
      title: 'Check the rules',
      description:
        'Runs the architecture rules and lists the findings with their quick fixes. With changeSetId: on baseline + change set, and each finding says whether the change introduced it.',
      inputSchema: {
        projectId: projectIdArg,
        changeSetId: changeSetIdArg,
        includeSuppressed: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true },
    },
    ({ projectId, changeSetId, includeSuppressed }) =>
      run(async () => {
        const { baseline, project: p, changeSet } = await readModel(ctx, projectId, changeSetId);
        const findings = runRules(p, catalog).filter((f) => includeSuppressed || !f.suppressed);
        const introduced = changeSet
          ? new Set(newFindings(runRules(baseline, catalog), findings).map(findingKey))
          : undefined;
        const fresh = introduced ? findings.filter((f) => introduced.has(findingKey(f))) : [];
        return ok(
          findings.map((f) => ({
            ...brief(f),
            ...(f.suppressed ? { suppressed: f.suppressed.reason } : {}),
            ...(introduced ? { introduced: introduced.has(findingKey(f)) } : {}),
          })),
          {
            revision: baseline.revision,
            hints: [
              findingsSummary(findings),
              ...(introduced
                ? [
                    `${fresh.length} finding(s) are introduced by change set "${changeSetId}" (${fresh.filter((f) => f.severity === 'error').length} error(s)).`,
                  ]
                : []),
            ],
          },
        );
      }),
  );

  server.registerTool(
    'apply_quick_fix',
    {
      title: 'Apply a quick fix',
      description:
        "Applies one of a finding's quick fixes (validate_project lists them with their index).",
      inputSchema: {
        projectId: projectIdArg,
        ruleId: z.string(),
        targetIds: z.array(z.string()).min(1),
        fixIndex: z.number().int().min(0).default(0),
      },
    },
    ({ projectId, ruleId, targetIds, fixIndex }) =>
      run(() =>
        change(ctx, projectId, (p) => {
          const finding = runRules(p, catalog).find(
            (f) => findingKey(f) === findingKey({ ruleId, targetIds }),
          );
          const fix = finding?.fixes[fixIndex];
          if (!fix)
            return {
              ops: [],
              errors: [
                {
                  code: 'NOT_FOUND',
                  message: finding
                    ? `${ruleId} has no fix ${fixIndex} (it has ${finding.fixes.length}).`
                    : `No finding ${ruleId} on ${targetIds.join(', ')}.`,
                },
              ],
            };
          return { ops: fix.ops, ids: targetIds, data: { applied: fix.title } };
        }),
      ),
  );

  server.registerTool(
    'suppress_finding',
    {
      title: 'Suppress a finding',
      description:
        'Accepts a finding on purpose, with a reason (at least 10 characters) and optionally a decision.',
      inputSchema: {
        projectId: projectIdArg,
        ruleId: z.string(),
        targetIds: z.array(z.string()).min(1),
        reason: z.string().min(10),
        decisionId: z.string().optional(),
      },
    },
    ({ projectId, ruleId, targetIds, reason, decisionId }) =>
      run(() =>
        change(ctx, projectId, () => ({
          ops: [
            {
              op: 'upsertSuppression',
              suppression: {
                ruleId,
                targetIds,
                reason,
                ...(decisionId ? { decisionId } : {}),
                createdAt: new Date().toISOString(),
              },
            },
          ],
          ids: targetIds,
        })),
      ),
  );

  // --- exports -------------------------------------------------------------------------

  server.registerTool(
    'export',
    {
      title: 'Export',
      description:
        'Exports the project: agent-md (ARCHITECTURE.md), agent-yaml, agents-snippet, onboarding-md, concept-pack, mermaid, dbml, json, likec4, structurizr, plantuml, openapi (focus: a route handler or contract), sequence (viewId: a scenario view). Change-set plans: plan-md, speckit, kiro (need changeSetId); other formats with changeSetId show baseline + change. With write: true, writes into the workspace folder: to "out" (relative to it), to the path in archguide.config.json exports, or under the default name (Spec Kit and Kiro files go to the repository root). Writing a plan marks a draft change set ready.',
      inputSchema: {
        projectId: projectIdArg,
        format: z.enum(EXPORT_FORMATS),
        focus: z.string().optional(),
        depth: z.number().int().min(1).max(5).optional(),
        level: LevelSchema.optional(),
        conceptId: z.string().optional(),
        changeSetId: changeSetIdArg,
        viewId: z.string().optional().describe('sequence: the scenario view.'),
        write: z.boolean().default(false),
        out: z.string().optional(),
      },
    },
    ({ projectId, format, write, out, ...options }) =>
      run(async () => {
        let p = await readProject(ctx, projectId);
        if (!write) {
          const files = exportFiles(ws, p, catalog, format, options);
          return ok(files.length === 1 ? files[0]!.content : files, { revision: p.revision });
        }
        if (ctx.readOnly)
          return fail([{ code: 'READ_ONLY', message: 'Writing files is off (--read-only).' }]);
        // A written plan is ready for implementation (draft → ready, §16.2).
        const cs = p.changeSets.find((c) => c.id === options.changeSetId);
        if (cs?.status === 'draft' && PLAN_FORMATS.includes(format)) {
          const r = await applyToWorkspace(
            ws,
            catalog,
            p.id,
            [{ op: 'upsertChangeSet', changeSet: storedChangeSet({ ...cs, status: 'ready' }, p) }],
            { origin: 'mcp', baseRevision: p.revision },
          );
          if (!r.ok) return fail(r.errors);
          p = r.project;
        }
        const written = await writeExport(
          ws,
          p,
          format,
          exportFiles(ws, p, catalog, format, options),
          out,
        );
        return ok({ written }, { revision: p.revision });
      }),
  );

  server.registerTool(
    'get_onboarding',
    {
      title: 'Onboarding pack',
      description:
        'ONBOARDING.md for someone joining the project: the big picture, the tour, rules of the road, decisions, glossary and the concepts it uses at the chosen level.',
      inputSchema: { projectId: projectIdArg, level: LevelSchema.default('intermediate') },
      annotations: { readOnlyHint: true },
    },
    ({ projectId, level }) =>
      run(async () => {
        const p = await readProject(ctx, projectId);
        return ok(exportProject('onboarding-md', p, catalog, { level }).files[0]!.content, {
          revision: p.revision,
        });
      }),
  );

  // --- learning ------------------------------------------------------------------------

  server.registerTool(
    'explain_concept',
    {
      title: 'Explain a concept',
      description:
        'The learning text for a concept ("pg.function"), relation type ("invokes"), rule ("RNP-001"), topic or pattern, at a level, with real-world uses and typical connections. Use it instead of guessing.',
      inputSchema: { id: z.string(), level: LevelSchema.default('intermediate') },
      annotations: { readOnlyHint: true },
    },
    ({ id, level }) =>
      run(async () => {
        const text = explainText(catalog, id, level);
        if (!text) {
          const like = searchDocs(catalogDocs(catalog), id.replace(/[.-]/g, ' ')).slice(0, 5);
          return fail([
            {
              code: 'NOT_FOUND',
              message: `No text "${id}".`,
              hint: like.length
                ? `Try: ${like.map((d) => d.id).join(', ')}.`
                : 'search_learning finds texts.',
            },
          ]);
        }
        return ok(text);
      }),
  );

  server.registerTool(
    'search_learning',
    {
      title: 'Search the learning texts',
      description: 'Finds learning texts by words, optionally in one track.',
      inputSchema: { query: z.string(), track: TrackSchema.optional() },
      annotations: { readOnlyHint: true },
    },
    ({ query, track }) =>
      run(async () =>
        ok(
          searchDocs(catalogDocs(catalog), query)
            .filter((d) => !track || d.tracks.includes(track))
            .slice(0, 20)
            .map((d) => ({
              id: d.id,
              title: d.title,
              summary: d.summary,
              level: d.level,
              tracks: d.tracks,
            })),
        ),
      ),
  );

  server.registerTool(
    'list_lessons',
    {
      title: 'List lessons',
      description:
        'Interactive lessons by track and level. Tracks: ' +
        TRACKS.map((t) => t.id).join(', ') +
        '.',
      inputSchema: { track: TrackSchema.optional(), level: LevelSchema.optional() },
      annotations: { readOnlyHint: true },
    },
    ({ track, level }) =>
      run(async () =>
        ok(
          catalogLessons(catalog)
            .filter((l) => (!track || l.track === track) && (!level || l.level === level))
            .map((l) => ({
              id: l.id,
              title: l.title,
              summary: l.summary,
              track: l.track,
              level: l.level,
              minutes: l.minutes,
              steps: l.steps.length,
            })),
        ),
      ),
  );

  server.registerTool(
    'get_lesson',
    {
      title: 'Get a lesson',
      description:
        'A lesson with its steps, to teach a user. Solutions are left out unless includeSolutions is true. Pair it with check_lesson_step.',
      inputSchema: { lessonId: z.string(), includeSolutions: z.boolean().default(false) },
      annotations: { readOnlyHint: true },
    },
    ({ lessonId, includeSolutions }) =>
      run(async () => {
        const lesson = catalogLessons(catalog).find((l) => l.id === lessonId);
        if (!lesson)
          return fail([
            {
              code: 'NOT_FOUND',
              message: `No lesson "${lessonId}".`,
              hint: 'list_lessons lists them.',
            },
          ]);
        return ok(
          includeSolutions
            ? lesson
            : {
                ...lesson,
                steps: lesson.steps.map(({ solution: _solution, ...s }) => s),
                start: undefined,
              },
        );
      }),
  );

  server.registerTool(
    'check_lesson_step',
    {
      title: 'Check a lesson step',
      description:
        "Whether the project passes a lesson step's check, with the reasons when it does not.",
      inputSchema: { projectId: projectIdArg, lessonId: z.string(), stepId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ projectId, lessonId, stepId }) =>
      run(async () => {
        const lesson = catalogLessons(catalog).find((l) => l.id === lessonId);
        const step = lesson?.steps.find((s) => s.id === stepId);
        if (!lesson || !step)
          return fail([{ code: 'NOT_FOUND', message: `No step "${stepId}" in "${lessonId}".` }]);
        const p = await readProject(ctx, projectId);
        const r = checkStep(p, step, { catalog, findings: runRules(p, catalog) });
        return ok({
          passed: r.passed,
          failures: r.failures,
          ...(r.passed && step.success ? { success: step.success } : {}),
        });
      }),
  );

  // --- tours ---------------------------------------------------------------------------

  server.registerTool(
    'list_tours',
    {
      title: 'List tours',
      description: 'Guided walkthroughs stored in the project.',
      inputSchema: { projectId: projectIdArg },
      annotations: { readOnlyHint: true },
    },
    ({ projectId }) => run(async () => ok((await readProject(ctx, projectId)).tours)),
  );

  server.registerTool(
    'draft_tour',
    {
      title: 'Draft a tour',
      description:
        'Drafts a tour from the diagram (actors → entry points → calls → data → async parts). Returned for review; save it with upsert_tour.',
      inputSchema: { projectId: projectIdArg },
      annotations: { readOnlyHint: true },
    },
    ({ projectId }) => run(async () => ok(draftTour(await readProject(ctx, projectId), catalog))),
  );

  server.registerTool(
    'upsert_tour',
    {
      title: 'Save a tour',
      description: 'Creates or replaces a tour.',
      inputSchema: { projectId: projectIdArg, tour: tourInput },
    },
    ({ projectId, tour }) =>
      run(() =>
        change(ctx, projectId, () => ({
          ops: [{ op: 'upsertTour', tour: tour as Tour }],
          ids: [tour.id],
        })),
      ),
  );
}
