import type { Catalog } from '../catalog';
import { slugify } from '../ids';
import { applyOps } from '../ops';
import { createProject } from '../project';
import type { Id, ModelOp, Project } from '../schema';
import { TemplateError, allTemplates, instantiateTemplate } from '../templates';
import type { Template } from '../templates';

/** A problem a tool reports: op errors, or tool-level ones with their own codes. */
export interface ToolProblem {
  code: string;
  message: string;
  itemId?: Id;
  hint?: string;
}

/** A template by ID or code ("T1"). */
export function findTemplate(catalog: Catalog, idOrCode: string): Template | undefined {
  return allTemplates(catalog).find((t) => t.id === idOrCode || t.code === idOrCode);
}

const unknownTemplate = (catalog: Catalog, idOrCode: string): ToolProblem => ({
  code: 'NOT_FOUND',
  message: `Unknown template "${idOrCode}".`,
  hint: `Templates: ${allTemplates(catalog)
    .map((t) => `${t.code} (${t.id})`)
    .join(', ')}.`,
});

/** Ops that stamp a template into a project, or the parameter problems. */
export function templateOps(
  catalog: Catalog,
  project: Project,
  idOrCode: string,
  options: {
    params?: Record<string, unknown>;
    origin?: { x: number; y: number };
    parentId?: Id;
  } = {},
): { ops: ModelOp[]; ids: Map<string, Id> } | { errors: ToolProblem[] } {
  const template = findTemplate(catalog, idOrCode);
  if (!template) return { errors: [unknownTemplate(catalog, idOrCode)] };
  try {
    const r = instantiateTemplate(template, project, catalog, {
      params: options.params,
      origin: options.origin ?? { x: 40, y: 40 },
      ...(options.parentId ? { parentId: options.parentId } : {}),
    });
    return { ops: r.ops, ids: r.ids };
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    return {
      errors: Object.entries(error.errors).map(([key, message]) => ({
        code: 'PARAM_INVALID',
        itemId: key,
        message: `${key}: ${message}`,
      })),
    };
  }
}

export interface NewProjectRequest {
  id?: Id;
  name: string;
  description?: string;
  /** Template ID or code to start from. */
  templateId?: string;
  params?: Record<string, unknown>;
  now?: string;
}

/** `create_project` and `archguide init`: an empty project, or one from a template. */
export function newProject(
  catalog: Catalog,
  request: NewProjectRequest,
): { project: Project } | { errors: ToolProblem[] } {
  const project = createProject({
    id: request.id ?? slugify(request.name),
    name: request.name,
    profile: catalog.profiles[0]?.id ?? 'core',
    ...(request.description ? { description: request.description } : {}),
    ...(request.now ? { now: request.now } : {}),
  });
  if (!request.templateId) return { project };
  const stamped = templateOps(catalog, project, request.templateId, { params: request.params });
  if ('errors' in stamped) return stamped;
  const r = applyOps(project, stamped.ops, catalog);
  return r.ok ? { project: r.project } : { errors: r.errors };
}
