import { makeElementId, makeRelationId, slugify, uniqueId } from '../ids';
import type { Catalog } from '../catalog';
import type { Element, Id, ModelOp, Project, Relation, Tour } from '../schema';
import type {
  ElementSpec,
  ParamValue,
  ParamValues,
  RelationExtra,
  Template,
  TourStepSpec,
} from './types';

export interface ResolvedParams {
  values: ParamValues;
  /** One message per invalid parameter, keyed by parameter key. */
  errors: Record<string, string>;
}

/** Fills in defaults and checks every parameter of a template. */
export function resolveParams(
  template: Template,
  input: Partial<Record<string, unknown>> = {},
): ResolvedParams {
  const values: ParamValues = {};
  const errors: Record<string, string> = {};
  for (const p of template.parameters) {
    const raw = input[p.key] ?? p.default;
    switch (p.type) {
      case 'string': {
        const v = typeof raw === 'string' ? raw.trim() : '';
        if (!v) errors[p.key] = `${p.label} is required.`;
        else if (!slugify(v)) errors[p.key] = `${p.label} needs at least one letter or digit.`;
        values[p.key] = v;
        break;
      }
      case 'number': {
        const v = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isInteger(v)) errors[p.key] = `${p.label} must be a whole number.`;
        else if (p.min !== undefined && v < p.min)
          errors[p.key] = `${p.label} is at least ${p.min}.`;
        else if (p.max !== undefined && v > p.max)
          errors[p.key] = `${p.label} is at most ${p.max}.`;
        values[p.key] = v;
        break;
      }
      case 'enum': {
        const v = String(raw);
        if (!p.options.includes(v))
          errors[p.key] = `${p.label} must be one of: ${p.options.join(', ')}.`;
        values[p.key] = v;
        break;
      }
      case 'string[]': {
        const list = (Array.isArray(raw) ? raw : String(raw).split(','))
          .map((x) => String(x).trim())
          .filter(Boolean);
        const slugs = list.map(slugify);
        if (list.length === 0) errors[p.key] = `${p.label} needs at least one item.`;
        else if (p.max !== undefined && list.length > p.max)
          errors[p.key] = `${p.label} has at most ${p.max} items.`;
        else if (slugs.some((s) => !s))
          errors[p.key] = `Every item of ${p.label} needs a letter or digit.`;
        else if (new Set(slugs).size !== slugs.length)
          errors[p.key] = `The items of ${p.label} must be different.`;
        values[p.key] = list;
        break;
      }
    }
  }
  return { values, errors };
}

/** Replaces `{key}` placeholders with parameter values (lists joined with ", "). */
export function fillPlaceholders(text: string, values: ParamValues): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const v: ParamValue | undefined = values[key];
    if (v === undefined) return match;
    return Array.isArray(v) ? v.join(', ') : String(v);
  });
}

/** The template's invariants with parameter values filled in. */
export function renderInvariants(template: Template, values: ParamValues): string[] {
  return template.invariants.map((i) => fillPlaceholders(i, values));
}

export interface InstantiateOptions {
  params?: Partial<Record<string, unknown>>;
  /** View that gets the template's shapes; defaults to the first view. */
  viewId?: Id;
  /** Where the template's top-left corner goes, in view coordinates. */
  origin?: { x: number; y: number };
  /** Status of the new elements and relations. Defaults to "planned". */
  status?: Element['status'];
}

export interface Instantiated {
  ops: ModelOp[];
  /** Template keys → new IDs. */
  ids: Map<string, Id>;
  /** New elements without a parent: what the template added at the top. */
  rootIds: Id[];
  values: ParamValues;
}

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly errors: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}

/**
 * Ops that add a template to a project (Implementation.md §12.1): elements, relations,
 * view nodes, its tour, `derivedFrom`, and its rule packs. IDs are made unique against the
 * project, so a template can be used several times. Apply the ops with `applyOps` as one
 * undo step.
 */
export function instantiateTemplate(
  template: Template,
  project: Project,
  catalog: Catalog,
  options: InstantiateOptions = {},
): Instantiated {
  const { values, errors } = resolveParams(template, options.params);
  if (Object.keys(errors).length > 0)
    throw new TemplateError(`Invalid parameters for ${template.name}.`, errors);

  const view = project.views.find((v) => v.id === options.viewId) ?? project.views[0];
  const origin = options.origin ?? { x: 0, y: 0 };
  const status = options.status ?? 'planned';
  const taken = new Set<Id>([
    ...project.model.elements.map((e) => e.id),
    ...project.model.relations.map((r) => r.id),
  ]);
  const ids = new Map<string, Id>();
  const elements: { el: Element; spec: ElementSpec }[] = [];
  const relations: Relation[] = [];
  const steps: TourStepSpec[] = [];
  const layout = template.folderLayout ?? {};

  const id = (key: string, what: string): Id => {
    const v = ids.get(key);
    if (!v) throw new TemplateError(`${template.id}: unknown ${what} "${key}".`);
    return v;
  };

  template.build(values, {
    el(key, kind, name, spec) {
      if (ids.has(key)) throw new TemplateError(`${template.id}: duplicate key "${key}".`);
      const concept = catalog.concepts.get(kind);
      if (!concept) throw new TemplateError(`${template.id}: unknown concept "${kind}".`);
      const elId = makeElementId(concept.idPrefix, name, taken);
      taken.add(elId);
      ids.set(key, elId);
      const { parent, x, y, ...extra } = spec;
      const codePath = layout[kind];
      const el: Element = {
        id: elId,
        kind,
        name,
        status,
        ...(parent ? { parentId: id(parent, 'parent') } : {}),
        ...(codePath && !extra.codePaths
          ? { codePaths: [fillPlaceholders(codePath, values)] }
          : {}),
        ...extra,
      };
      elements.push({ el, spec: { x, y, ...(parent ? { parent } : {}) } });
      return key;
    },
    rel(sourceKey, type, targetKey, extra: RelationExtra = {}) {
      const sourceId = id(sourceKey, 'source');
      const targetId = id(targetKey, 'target');
      const relId = makeRelationId(sourceId, type, targetId, taken);
      taken.add(relId);
      const key = `${sourceKey}>${type}>${targetKey}`;
      ids.set(key, relId);
      relations.push({ id: relId, type, sourceId, targetId, status, ...extra });
      return key;
    },
    step(step) {
      steps.push(step);
    },
  });

  const ops: ModelOp[] = [];
  for (const { el } of elements) ops.push({ op: 'addElement', element: el });
  for (const r of relations) ops.push({ op: 'addRelation', relation: r });
  if (view) {
    for (const { el, spec } of elements) {
      const nested = spec.parent !== undefined;
      ops.push({
        op: 'setViewNode',
        viewId: view.id,
        node: {
          elementId: el.id,
          x: nested ? spec.x : origin.x + spec.x,
          y: nested ? spec.y : origin.y + spec.y,
        },
      });
    }
    for (const r of relations)
      ops.push({ op: 'setViewEdge', viewId: view.id, edge: { relationId: r.id } });
  }

  if (steps.length > 0) {
    const tourIds = new Set(project.tours.map((t) => t.id));
    const tour: Tour = {
      id: uniqueId(`tour.${slugify(template.id)}`, tourIds),
      title: `Tour: ${template.name}`,
      description: template.summary,
      audience: 'any',
      steps: steps.map((s, i) => ({
        id: `step-${i + 1}`,
        title: s.title,
        body: fillPlaceholders(s.body, values),
        elementIds: (s.elements ?? []).map((k) => id(k, 'tour element')),
        relationIds: (s.relations ?? []).map((k) => id(k, 'tour relation')),
        ...(s.conceptIds ? { conceptIds: s.conceptIds } : {}),
      })),
    };
    ops.push({ op: 'upsertTour', tour });
  }

  const rootIds = elements.filter(({ el }) => !el.parentId).map(({ el }) => el.id);
  ops.push({
    op: 'updateProject',
    patch: {
      derivedFrom: [
        ...(project.derivedFrom ?? []),
        { templateId: template.id, templateVersion: template.version, rootIds },
      ],
    },
  });
  const packs = [...new Set([...project.settings.rulePacks, ...template.rulePacks])];
  if (packs.length !== project.settings.rulePacks.length)
    ops.push({ op: 'updateSettings', patch: { rulePacks: packs } });

  return { ops, ids, rootIds, values };
}

/** Built-in templates of every profile in the catalog. */
export function allTemplates(catalog: Catalog): Template[] {
  return catalog.profiles.flatMap((p) => p.templates ?? []);
}
